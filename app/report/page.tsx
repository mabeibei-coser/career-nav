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
import { consumeBgSections } from "@/lib/report-bg-runner";
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

    // 3. 消费 bg-runner 的 5 个 promise（null = 从未启动，空 Map = 刷新丢失）
    //    两种 miss 都用 mock 兜底渲染，不再 redirect /loading 避免无限循环
    const bgPromises = consumeBgSections(formData, quizAnswers);
    if (!bgPromises || bgPromises.size === 0) {
      console.warn("[report-page] bg miss, rendering with mock data");
      setSections({
        overview: { data: MOCK_OVERVIEW, status: "mock" },
        strength: { data: MOCK_STRENGTH, status: "mock" },
        positioning: { data: MOCK_POSITIONING, status: "mock" },
        resumeDiagnosis: { data: hasResume ? MOCK_RESUME_DIAGNOSIS : null, status: hasResume ? "mock" : "done" },
        advice: { data: MOCK_ADVICE, status: "mock" },
      });
      return;
    }

    // 跳过简历快诊：无简历 → 直接 done(null)，不等 promise
    if (!hasResume) {
      setSections((s) => ({
        ...s,
        resumeDiagnosis: { data: null, status: "done" },
      }));
    }

    // 各 section 独立 await，互不阻塞。每个 await 一份独立 promise，
    // 装配 5 个不同类型的 section 字段——因此分开写 5 段 await，TS 类型一目了然。
    const updateSection = <K extends keyof SectionsState>(
      key: K,
      data: SectionsState[K]["data"],
      status: SectionStatus
    ) => {
      setSections((s) => ({ ...s, [key]: { data, status } }));
    };

    async function consume<K extends keyof SectionsState>(
      key: K,
      mock: NonNullable<SectionsState[K]["data"]>,
      label: string
    ) {
      const p = bgPromises!.get(key);
      if (!p) {
        console.warn(`[report-page] bg promise miss for ${key}, fallback to mock`);
        updateSection(key, mock, "mock");
        return;
      }
      try {
        const data = (await p) as SectionsState[K]["data"];
        if (data == null) {
          console.warn(`[report-page] ${label} resolved null, using mock`);
          updateSection(key, mock, "mock");
          return;
        }
        updateSection(key, data, "done");
      } catch (err) {
        console.warn(`[report-page] ${label} promise failed:`, err);
        updateSection(key, mock, "mock");
      }
    }

    const completions: Promise<void>[] = [
      consume("overview", MOCK_OVERVIEW, "总评"),
      consume("strength", MOCK_STRENGTH, "优势发现"),
      consume("positioning", MOCK_POSITIONING, "职业定位"),
      consume("advice", MOCK_ADVICE, "行动建议"),
    ];
    if (hasResume) {
      completions.push(consume("resumeDiagnosis", MOCK_RESUME_DIAGNOSIS, "简历快诊"));
    }

    // 全部 settled 后：装 ReportData + 落库
    Promise.allSettled(completions).then(() => {
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

  // ============ 落 SQLite（幂等：同一 mount 内只发一次）============
  function finalizeOnce(
    reportData: ReportData,
    formData: JobFormData,
    quizAnswers: QuizAnswer[]
  ) {
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    const resumeRef = sessionStorage.getItem("resumeRef") ?? undefined;
    const resumeFilename = sessionStorage.getItem("resumeFilename") ?? undefined;
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

  const dateLabel = new Date(meta.generatedAt).toLocaleDateString("zh-CN");
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
          {/* Header — 标题 + 元信息（生成时间 / 用户身份 / 目标岗位回显） */}
          <div
            data-pdf-section="header"
            className="mx-auto max-w-5xl px-4 sm:px-6 pt-8 sm:pt-10 pb-6 print:pt-0"
          >
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
              {position} · 职业导航报告
            </h1>
            <p className="text-xs sm:text-sm text-[var(--report-ink-muted)]">
              生成于 {dateLabel} · 共 5 个模块
            </p>
          </div>

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
