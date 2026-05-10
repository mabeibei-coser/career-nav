import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import type {
  InterviewQ1Q2,
  JobFormData,
  QuizAnswer,
  ReportData,
  ScoringResult,
} from "@/lib/types";

export const runtime = "nodejs";

// TODO V2: 实施 PII 脱敏管道（身份证号 / 手机号 / 家庭住址 / 邮箱）
// 当前 V1 直接存原文，遵从用户 UC3 决策"参照 career-report"。
// 入库的 form_data_json / report_json 含简历原文，包含潜在 PII。
// V2 应在写库前跑一遍正则脱敏 + 标记 has_pii 字段，便于后续清理。

// 老 schema（career-report 复用）字段：target_position / target_education /
// target_company / target_city_tier 在新 5 模块流程下没有数据来源（除
// targetPosition 外都是 undefined）。本路由保留这些列的写入以兼容现有表结构，
// 同时 ALTER TABLE 加入新 schema 列。
const NEW_COLUMNS: { name: string; ddl: string }[] = [
  { name: "uuid", ddl: "TEXT" },
  { name: "user_identity", ddl: "TEXT" },
  { name: "form_data_json", ddl: "TEXT" },
  { name: "quiz_answers_json", ddl: "TEXT" },
  { name: "scoring_json", ddl: "TEXT" },
  { name: "interview_q1q2_json", ddl: "TEXT" },
  { name: "report_json", ddl: "TEXT" },
  { name: "status", ddl: "TEXT DEFAULT 'completed'" },
];

let _migrated = false;
function ensureSchema(db: ReturnType<typeof getDb>): void {
  if (_migrated) return;
  const cols = db
    .prepare("PRAGMA table_info(reports)")
    .all() as { name: string }[];
  const existing = new Set(cols.map((c) => c.name));
  for (const col of NEW_COLUMNS) {
    if (!existing.has(col.name)) {
      db.exec(`ALTER TABLE reports ADD COLUMN ${col.name} ${col.ddl}`);
    }
  }
  // 给 uuid 加索引，让按 uuid 查报告快一点
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_reports_uuid ON reports(uuid)`
  );
  _migrated = true;
}

interface FinalizeRequestBody {
  formData: JobFormData;
  quizAnswers?: QuizAnswer[];
  scoring?: ScoringResult;
  interviewQ1Q2?: InterviewQ1Q2;
  reportData: ReportData;
  // 兼容现有 loading 页 caller 仍在传的字段
  sectionsStatus?: unknown;
  durationMs?: number;
  resumeRef?: string;
  resumeFilename?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<FinalizeRequestBody>;
    const {
      formData,
      quizAnswers,
      scoring,
      interviewQ1Q2,
      reportData,
      sectionsStatus,
      durationMs,
      resumeRef,
      resumeFilename,
    } = body ?? {};

    if (!formData?.identity) {
      return NextResponse.json({ error: "缺少 formData" }, { status: 400 });
    }
    if (!reportData) {
      return NextResponse.json({ error: "缺少 reportData" }, { status: 400 });
    }

    const db = getDb();
    ensureSchema(db);

    // scoring / interviewQ1Q2 优先走显式入参，否则从 reportData.meta 兜底
    const finalScoring: ScoringResult | undefined =
      scoring ?? reportData.meta?.scoring;
    const finalQ1Q2: InterviewQ1Q2 | undefined =
      interviewQ1Q2 ?? reportData.meta?.interviewQ1Q2;

    if (!finalScoring) {
      return NextResponse.json({ error: "缺少 scoring" }, { status: 400 });
    }

    const uuid = randomUUID();
    const createdAt = Date.now();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    const userAgent = req.headers.get("user-agent") ?? "";
    const hasResume = resumeRef && resumeFilename ? 1 : 0;

    // 事务性插入主记录 + 立刻把 report JSON 落盘并回填 storage_path
    const reportsDir = path.join(process.cwd(), "data", "reports");
    fs.mkdirSync(reportsDir, { recursive: true });

    const txn = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO reports
            (created_at, target_position, target_education, target_company, target_city_tier,
             has_resume, resume_filename, sections_status, ip, user_agent, duration_ms,
             uuid, user_identity, form_data_json, quiz_answers_json, scoring_json,
             interview_q1q2_json, report_json, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          createdAt,
          formData.targetPosition ?? "",
          // 新 5 模块表单没有这些老字段，全部写 null（保留列以兼容老查询）
          null,
          null,
          null,
          hasResume,
          resumeFilename ?? null,
          sectionsStatus ? JSON.stringify(sectionsStatus) : null,
          ip,
          userAgent,
          durationMs ?? null,
          uuid,
          formData.identity ?? null,
          JSON.stringify(formData),
          quizAnswers ? JSON.stringify(quizAnswers) : null,
          JSON.stringify(finalScoring),
          finalQ1Q2 ? JSON.stringify(finalQ1Q2) : null,
          JSON.stringify(reportData),
          "completed"
        );
      return result.lastInsertRowid as number;
    });

    const reportRowId = txn();

    // 同时落一份 JSON 到磁盘（兼容已有的 admin/reports 文件读取路径）
    const reportPath = path.join(reportsDir, `${uuid}.json`);
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        formData,
        quizAnswers,
        scoring: finalScoring,
        interviewQ1Q2: finalQ1Q2,
        reportData,
        sectionsStatus,
      })
    );
    db.prepare(
      "UPDATE reports SET report_storage_path = ? WHERE id = ?"
    ).run(reportPath, reportRowId);

    // 把简历从 temp 搬到永久目录（按 uuid 归档）
    if (hasResume && resumeRef && resumeFilename) {
      const srcPath = path.join(
        process.cwd(),
        "data",
        "temp",
        resumeRef,
        resumeFilename
      );
      if (fs.existsSync(srcPath)) {
        const destDir = path.join(process.cwd(), "data", "resumes", uuid);
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, resumeFilename);
        fs.renameSync(srcPath, destPath);
        db.prepare(
          "UPDATE reports SET resume_storage_path = ? WHERE id = ?"
        ).run(destPath, reportRowId);
        try {
          fs.rmdirSync(path.join(process.cwd(), "data", "temp", resumeRef));
        } catch {
          /* 非空目录就跳过 */
        }
      }
    }

    return NextResponse.json({
      id: uuid,
      url: `/report/${uuid}`,
      // 保留 reportId 字段不破坏现有 loading 页 caller（即便它当前是 fire-and-forget）
      reportId: reportRowId,
    });
  } catch (error) {
    console.error("[finalize] error:", error);
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}
