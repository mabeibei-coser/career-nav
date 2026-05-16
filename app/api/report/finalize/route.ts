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

// V1 polish (T3): report_json 列是单一真相来源；不再往磁盘写 report 文件。
// 老 schema 字段（target_education/target_company/target_city_tier）在新 5 模块流程下没有
// 数据来源（除 targetPosition 外都是 undefined）。保留写 null 以兼容表结构。
// PII V2 推迟：form_data_json / report_json 含简历原文，未来需脱敏管道（身份证/手机/地址/邮箱）。

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
  /** 客户端幂等 key：form 页生成并存 sessionStorage，loading/report 页 finalize 都用同一个，
   *  防止同一次走完流程在 admin 出现多条记录。同 uuid 第二次请求直接返回首次结果。 */
  uuid?: string;
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
      uuid: clientUuid,
    } = body ?? {};

    if (!formData?.identity) {
      return NextResponse.json({ error: "缺少 formData" }, { status: 400 });
    }
    if (!reportData) {
      return NextResponse.json({ error: "缺少 reportData" }, { status: 400 });
    }

    const db = getDb();

    // 幂等保护：如果客户端传了 uuid 且该 uuid 已在 reports 表里 → 直接返回首次结果
    // 防止 loading 页 + report 页 + React 双 mount 多次 fetch finalize 出现多条记录
    if (clientUuid) {
      const existing = db
        .prepare("SELECT id, uuid FROM reports WHERE uuid = ?")
        .get(clientUuid) as { id: number; uuid: string } | undefined;
      if (existing) {
        return NextResponse.json({
          id: existing.uuid,
          url: `/report/${existing.uuid}`,
          reportId: existing.id,
          duplicate: true,
        });
      }
    }

    // scoring / interviewQ1Q2 优先走显式入参，否则从 reportData.meta 兜底
    const finalScoring: ScoringResult | undefined =
      scoring ?? reportData.meta?.scoring;
    const finalQ1Q2: InterviewQ1Q2 | undefined =
      interviewQ1Q2 ?? reportData.meta?.interviewQ1Q2;

    if (!finalScoring) {
      return NextResponse.json({ error: "缺少 scoring" }, { status: 400 });
    }

    // 优先用客户端传的幂等 uuid；没传就生成新的
    const uuid = clientUuid || randomUUID();
    const createdAt = Date.now();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    const userAgent = req.headers.get("user-agent") ?? "";
    const hasResume = resumeRef && resumeFilename ? 1 : 0;

    // V1 polish (T3): 不再往磁盘写 report 文件，report_json 列即单一真相
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

    // 并发场景兜底：前置 SELECT 通过但 INSERT 时被并发请求抢先插入了同 uuid。
    // SQLite UNIQUE 约束会抛错，捕获后回查已存在行返回。
    let reportRowId: number;
    try {
      reportRowId = txn();
    } catch (e) {
      const isUniqueError = /UNIQUE constraint failed/i.test(String(e));
      if (isUniqueError && clientUuid) {
        const existing = db
          .prepare("SELECT id, uuid FROM reports WHERE uuid = ?")
          .get(clientUuid) as { id: number; uuid: string } | undefined;
        if (existing) {
          return NextResponse.json({
            id: existing.uuid,
            url: `/report/${existing.uuid}`,
            reportId: existing.id,
            duplicate: true,
          });
        }
      }
      throw e;
    }

    // 把简历从 temp 搬到永久目录（按 uuid 归档）
    // 注：简历是用户上传的原始文件，仍需磁盘存（区别于 report_json 是生成内容）
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
