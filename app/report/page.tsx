"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { EDUCATION_OPTIONS } from "@/lib/form-options";
import { ReportRenderContext } from "@/components/report/report-context";
import { OverviewSection } from "@/components/report/overview-section";
import StrengthSection from "@/components/report/strength-section";
import PositioningSection from "@/components/report/positioning-section";
import ResumeDiagnosisSection from "@/components/report/resume-diagnosis-section";
import AdviceSection from "@/components/report/advice-section";
import { ExportActions } from "@/components/report/export-actions";
import { consumeBgGeneratePromise } from "@/lib/report-bg-runner";
import {
  MOCK_ADVICE,
  MOCK_OVERVIEW,
  MOCK_POSITIONING,
  MOCK_RESUME_DIAGNOSIS,
  MOCK_STRENGTH,
} from "@/lib/mocks/report-mocks";
import type {
  Advice,
  InterviewQ1Q2,
  JobFormData,
  Overview,
  Positioning,
  QuizAnswer,
  ReportData,
  ReportMeta,
  ResumeDiagnosis,
  ScoringResult,
  Strength,
} from "@/lib/types";

// Section 加载状态：done = 真实数据，mock = 兜底，loading = 还在 await
type SectionStatus = "loading" | "done" | "mock";

interface SectionsState {
  overview: { data: Overview | null; status: SectionStatus };
  strength: { data: Strength | null; status: SectionStatus };
  positioning: { data: Positioning | null; status: SectionStatus };
  resumeDiagnosis: { data: ResumeDiagnosis | null; status: SectionStatus };
  advice: { data: Advice | null; status: SectionStatus };
}

const INITIAL_SECTIONS: SectionsState = {
  overview: { data: null, status: "loading" },
  strength: { data: null, status: "loading" },
  positioning: { data: null, status: "loading" },
  resumeDiagnosis: { data: null, status: "loading" },
  advice: { data: null, status: "loading" },
};

// 从 sessionStorage 读 interviewData → 提取 Q1Q2 摘要文本
function extractInterviewQ1Q2(): InterviewQ1Q2 {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem("interviewData");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      turns?: Array<{ index?: number; userAnswerText?: string }>;
    };
    const turns = Array.isArray(parsed.turns) ? parsed.turns : [];
    const q1 = turns.find((t) => t?.index === 0)?.userAnswerText;
    const q2 = turns.find((t) => t?.index === 1)?.userAnswerText;
    return {
      ...(q1 ? { Q1: q1 } : {}),
      ...(q2 ? { Q2: q2 } : {}),
    };
  } catch {
    return {};
  }
}

export default function ReportPage() {
  const router = useRouter();
  const reportContainerRef = useRef<HTMLDivElement>(null);

  // 启动数据：来自 sessionStorage（form / quiz / interview 三页留下的）
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [sections, setSections] = useState<SectionsState>(INITIAL_SECTIONS);

  // 控制状态
  const [bootError, setBootError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const finalizedRef = useRef(false);

  // ?pdf=1：Puppeteer 服务端渲染时挂这个 flag，让所有动画关掉
  const [isPdfMode, setIsPdfMode] = useState(false);

  // ============ Mount：装配 meta + 启动 5 个 promise 消费 ============
  useEffect(() => {
    if (typeof window === "undefined") return;

    const sp = new URLSearchParams(window.location.search);
    if (sp.get("pdf") === "1") setIsPdfMode(true);

    // 1. 必备的三件输入：formData / quizAnswers / interviewQ1Q2
    let formData: JobFormData;
    let quizAnswers: QuizAnswer[];
    let scoring: ScoringResult;
    try {
      const fd = sessionStorage.getItem("formData");
      const qa = sessionStorage.getItem("quizAnswers");
      const sc = sessionStorage.getItem("scoring");
      if (!fd || !qa || !sc) {
        // 任一缺失 → 回填表流程，不在 report 页显示空数据
        router.replace("/");
        return;
      }
      formData = JSON.parse(fd) as JobFormData;
      quizAnswers = JSON.parse(qa) as QuizAnswer[];
      scoring = JSON.parse(sc) as ScoringResult;
      if (!formData?.identity) {
        router.replace("/");
        return;
      }
    } catch (e) {
      console.error("[report-page] sessionStorage 读取失败:", e);
      setBootError("会话数据读取失败，请返回重填");
      return;
    }

    const interviewQ1Q2 = extractInterviewQ1Q2();
    const hasResume = Boolean(
      formData.resumeText && formData.resumeText.length > 50
    );

    const builtMeta: ReportMeta = {
      generatedAt: new Date().toISOString(),
      formData,
      scoring,
      hasResume,
      interviewQ1Q2,
    };
    setMeta(builtMeta);

    // 2. 快路径：sessionStorage.reportData 已被早前 loading 页装配过 → 直接复用
    const cached = sessionStorage.getItem("reportData");
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as ReportData;
        if (parsed?.meta?.formData?.identity) {
          setSections({
            overview: { data: parsed.overview ?? null, status: "done" },
            strength: { data: parsed.strength ?? null, status: "done" },
            positioning: { data: parsed.positioning ?? null, status: "done" },
            resumeDiagnosis: {
              data: parsed.resumeDiagnosis ?? null,
              status: "done",
            },
            advice: { data: parsed.advice ?? null, status: "done" },
          });
          // meta 用缓存的（带原始 generatedAt）
          setMeta(parsed.meta);
          // 仍尝试落库一次（idempotent，失败忽略）
          finalizeOnce(parsed, formData, quizAnswers);
          return;
        }
      } catch {
        // 缓存损坏 → 走下面的 promise 路径
      }
    }

    // 3. 消费 bg-runner 的 generate promise（null = 从未启动或刷新丢失）
    //    miss 时 mock 兜底渲染，不 redirect /loading 避免无限循环
    const bgGeneratePromise = consumeBgGeneratePromise(formData, quizAnswers, interviewQ1Q2);
    if (!bgGeneratePromise) {
      console.warn("[report-page] bg generate promise miss, rendering with mock data");
      setSections({
        overview: { data: MOCK_OVERVIEW, status: "mock" },
        strength: { data: MOCK_STRENGTH, status: "mock" },
        positioning: { data: MOCK_POSITIONING, status: "mock" },
        resumeDiagnosis: {
          data: hasResume ? MOCK_RESUME_DIAGNOSIS : null,
          status: hasResume ? "mock" : "done",
        },
        advice: { data: MOCK_ADVICE, status: "mock" },
      });
      return;
    }

    // 等单次 generate promise，拆包全部 5 个模块
    type GenerateSections = {
      overview?: Overview | null;
      strength?: Strength | null;
      positioning?: Positioning | null;
      resumeDiagnosis?: ResumeDiagnosis | null;
      advice?: Advice | null;
    };

    (async () => {
      let sections: GenerateSections | null = null;
      try {
        sections = (await bgGeneratePromise) as GenerateSections | null;
      } catch (err) {
        console.warn("[report-page] bg generate promise failed, using mock:", err);
      }

      const s = sections ?? {};
      setSections({
        overview: { data: s.overview ?? MOCK_OVERVIEW, status: s.overview ? "done" : "mock" },
        strength: { data: s.strength ?? MOCK_STRENGTH, status: s.strength ? "done" : "mock" },
        positioning: { data: s.positioning ?? MOCK_POSITIONING, status: s.positioning ? "done" : "mock" },
        resumeDiagnosis: {
          data: hasResume ? (s.resumeDiagnosis ?? MOCK_RESUME_DIAGNOSIS) : null,
          status: hasResume ? (s.resumeDiagnosis ? "done" : "mock") : "done",
        },
        advice: { data: s.advice ?? MOCK_ADVICE, status: s.advice ? "done" : "mock" },
      });
    })().then(() => {
      // 装配最终 ReportData，从最新 state 读（用 setSections 的 functional update 拿到）
      setSections((latest) => {
        const finalReport: ReportData = {
          meta: builtMeta,
          overview: (latest.overview.data ?? MOCK_OVERVIEW) as Overview,
          strength: (latest.strength.data ?? MOCK_STRENGTH) as Strength,
          positioning: (latest.positioning.data ?? MOCK_POSITIONING) as Positioning,
          resumeDiagnosis: hasResume
            ? ((latest.resumeDiagnosis.data ?? MOCK_RESUME_DIAGNOSIS) as ResumeDiagnosis)
            : null,
          advice: (latest.advice.data ?? MOCK_ADVICE) as Advice,
        };
        try {
          sessionStorage.setItem("reportData", JSON.stringify(finalReport));
        } catch {
          /* 配额满忽略 */
        }
        finalizeOnce(finalReport, formData, quizAnswers);
        return latest;
      });
    });
  }, [router]);

  // ============ 落 SQLite（幂等：同一 mount 内只发一次 + uuid 跨页/跨刷新去重）============
  function finalizeOnce(
    reportData: ReportData,
    formData: JobFormData,
    quizAnswers: QuizAnswer[]
  ) {
    if (finalizedRef.current) return;
    // Puppeteer 服务端渲染 PDF 时也会跑到这个 useEffect（带 ?pdf=1），
    // 它的 sessionStorage 里没有 reportUuid，finalize 会用新 uuid 入库一条多余记录。
    // 直接在 PDF 模式跳过 finalize。
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("pdf") === "1"
    ) {
      return;
    }
    finalizedRef.current = true;
    const resumeRef = sessionStorage.getItem("resumeRef") ?? undefined;
    const resumeFilename = sessionStorage.getItem("resumeFilename") ?? undefined;
    // 复用 form 页生成的 reportUuid 做幂等。loading 页已用同一 uuid finalize 过，
    // 此处 fetch 后端会返回 duplicate:true 不重复 INSERT。
    const reportUuid = sessionStorage.getItem("reportUuid") ?? undefined;
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formData,
        quizAnswers,
        reportData,
        sectionsStatus: {},
        resumeRef,
        resumeFilename,
        uuid: reportUuid,
      }),
    }).catch((e) => console.warn("[report-page] finalize failed (ignored):", e));
  }

  // ============ Render ============
  const ctxValue = useMemo(
    () => ({ exporting: isExporting || isPdfMode }),
    [isExporting, isPdfMode]
  );

  if (bootError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[var(--blue-50)]/60 to-white px-6">
        <div className="max-w-md text-center space-y-4">
          <div className="text-lg font-semibold text-[var(--navy-900)]">
            {bootError}
          </div>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="h-10 px-6 bg-[var(--blue-500)] hover:bg-[var(--blue-600)] text-white font-medium rounded-lg"
          >
            返回填写信息
          </button>
        </div>
      </div>
    );
  }

  if (!meta) {
    // sessionStorage 读取/redirect 期间的最短闪屏
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[var(--blue-50)]/60 to-white">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--blue-500)] border-t-transparent rounded-full" />
      </div>
    );
  }

  // 从简历文本提取姓名
  const extractedName = (() => {
    const txt = meta.formData.resumeText;
    if (!txt) return "";
    const CJK = "\\u4e00-\\u9fff";

    // 1) "姓名" / "姓 名" / "名字" 标签后（允许无分隔符 "姓名张三"）
    const labelRe = new RegExp(`(?:姓\\s*名|名\\s*字)[\\s:：]*([${CJK}]{2,5})`);
    const labelMatch = txt.match(labelRe);
    if (labelMatch) return labelMatch[1];

    // 2) 首行开头 2-5 个中文字（后面可能跟手机号、邮箱、竖线等）
    const firstLine = txt.split(/[\n\r]/)[0]?.trim() ?? "";
    const headRe = new RegExp(`^([${CJK}]{2,5})(?:\\s|[|·•,，]|$)`);
    const headMatch = firstLine.match(headRe);
    if (headMatch) return headMatch[1];

    // 3) 前 10 行里找独立的 2-4 个中文字行（常见简历排版）
    const lines = txt.split(/[\n\r]/).slice(0, 10);
    const pureRe = new RegExp(`^[${CJK}]{2,4}$`);
    for (const line of lines) {
      const trimmed = line.trim();
      if (pureRe.test(trimmed)) return trimmed;
    }
    return "";
  })();
  const displayName = extractedName || meta.formData.targetPosition;

  const dateLabel = (() => {
    const d = new Date(meta.generatedAt);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}年${m}月${day}日 ${h}:${min}`;
  })();
  const position = meta.formData.targetPosition;
  const hasResume = meta.hasResume;
  const identityLabel =
    meta.formData.identity === "recent_grad"
      ? "应届毕业生"
      : meta.formData.identity === "young_unemployed"
        ? "35岁以下求职者"
        : "35岁以上求职者";

  // 装配 ReportData（用于 ExportActions / PDF 导出，可能含 mock）
  const composedReport: ReportData = {
    meta,
    overview: (sections.overview.data ?? MOCK_OVERVIEW) as Overview,
    strength: (sections.strength.data ?? MOCK_STRENGTH) as Strength,
    positioning: (sections.positioning.data ?? MOCK_POSITIONING) as Positioning,
    resumeDiagnosis: hasResume
      ? ((sections.resumeDiagnosis.data ?? MOCK_RESUME_DIAGNOSIS) as ResumeDiagnosis)
      : null,
    advice: (sections.advice.data ?? MOCK_ADVICE) as Advice,
  };

  return (
    <ReportRenderContext.Provider value={ctxValue}>
      <div className="report-shell pb-24 print:pb-0 print:bg-white">
        <div ref={reportContainerRef}>
          {/* Header — 标题 + 元信息（PDF 导出时跳过，避免空白首页） */}
          {!isExporting && !isPdfMode && (
            <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-8 sm:pt-10 pb-6 print:pt-0">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <Badge
                  variant="secondary"
                  className="bg-[var(--blue-500)] text-white text-xs"
                >
                  职业导航报告
                </Badge>
                <Badge variant="secondary" className="bg-white text-xs">
                  {position}
                </Badge>
                <Badge variant="secondary" className="bg-white text-xs">
                  {identityLabel}
                </Badge>
                {meta.formData.education && (
                  <Badge variant="secondary" className="bg-white text-xs">
                    {EDUCATION_OPTIONS.find((o) => o.value === meta.formData.education)?.label ?? meta.formData.education}
                  </Badge>
                )}
                {hasResume && (
                  <Badge
                    variant="secondary"
                    className="bg-emerald-100 text-emerald-700 text-xs"
                  >
                    已结合简历
                  </Badge>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-[var(--navy-950)] tracking-tight mb-2">
                {displayName} · 职业导航报告
              </h1>
              <p className="text-xs sm:text-sm text-[var(--report-ink-muted)]">
                生成于 {dateLabel} · 共 5 个模块
              </p>
            </div>
          )}

          {/* 5 个 Section 纵向堆叠 */}
          <div className="mx-auto max-w-5xl px-4 sm:px-6 space-y-4 sm:space-y-5">
            {/* ① 总评 */}
            <OverviewSection
              data={sections.overview.data}
              meta={meta}
              index={1}
              total={5}
            />

            {/* ② 优势发现 */}
            <StrengthSection
              data={sections.strength.data}
              index={2}
              total={5}
            />

            {/* ③ 职业定位 */}
            <PositioningSection
              data={sections.positioning.data}
              index={3}
              total={5}
            />

            {/* ④ 简历快诊（hasResume=false 时组件内部自带 "已跳过" 兜底） */}
            <ResumeDiagnosisSection
              data={sections.resumeDiagnosis.data}
              hasResume={hasResume}
              index={4}
              total={5}
            />

            {/* ⑤ 行动建议 */}
            <AdviceSection
              data={sections.advice.data}
              index={5}
              total={5}
            />

            {/* Disclaimer */}
            <div
              data-pdf-section="disclaimer"
              className="rounded-xl border border-[var(--blue-100)] bg-white p-4 text-[12px] leading-relaxed text-[var(--report-ink-muted)] break-inside-avoid-page"
            >
              <strong className="text-[var(--navy-700)]">免责声明：</strong>
              本报告由 AI 基于公开信息和你的输入生成，仅作为职业定位的参考，不构成就业、岗位匹配或薪资承诺。具体岗位匹配请以上海市公共招聘网或 12333 公共就业服务热线为准。
            </div>
          </div>
        </div>

        {/* 底部 Sticky：PDF 导出 / 打印 / 重新分析（PDF 模式自动隐藏） */}
        {!isPdfMode && (
          <ExportActions
            report={composedReport}
            containerRef={reportContainerRef}
            onExportingChange={setIsExporting}
            onNewAnalysis={() => {
              // 清掉本次会话数据，回到表单
              try {
                sessionStorage.removeItem("reportData");
              } catch {}
              router.push("/");
            }}
          />
        )}
      </div>
    </ReportRenderContext.Provider>
  );
}
