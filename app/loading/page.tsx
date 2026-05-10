"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Loader2,
  Circle,
  AlertTriangle,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import {
  consumeAll,
  type SectionProgress,
  type SectionStatus,
} from "@/lib/report-client";
import {
  MOCK_ADVICE,
  MOCK_OVERVIEW,
  MOCK_POSITIONING,
  MOCK_RESUME_DIAGNOSIS,
  MOCK_STRENGTH,
} from "@/lib/mocks/report-mocks";
import { cn } from "@/lib/utils";
import { StepIndicator } from "@/components/ui/step-indicator";
import type {
  JobFormData,
  QuizAnswer,
  ReportData,
  ReportSectionKey,
  ScoringResult,
  UserIdentity,
} from "@/lib/types";

const cubicEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

// 5 模块固定顺序：与 SECTION_CONFIG 一致，但展示顺序按"用户期待的阅读顺序"
const DISPLAY_ORDER: ReportSectionKey[] = [
  "overview",
  "strength",
  "positioning",
  "resumeDiagnosis",
  "advice",
];

const SECTION_LABELS: Record<ReportSectionKey, string> = {
  overview: "总评",
  strength: "优势发现",
  positioning: "职业定位",
  resumeDiagnosis: "简历快诊",
  advice: "行动建议",
};

// 90 秒超时（design review 要求：不让用户无限等）
const TIMEOUT_MS = 90_000;

// ===== 身份化 Tips =====

// 失业 / 求职中：强调"重新出发"的友好语气，按 design review 1.1 的措辞
const TIPS_JOBSEEKER: string[] = [
  "正在为你梳理职业方向，这通常需要 30 秒到 1 分钟",
  "你已经迈出了重新出发的第一步，剩下的路慢慢走也来得及",
  "评估结果只是参考，最终决定权在你手上",
  "稳定的过往经验是你的底色，AI 会优先把它们标出来",
  "投递不顺不是能力问题，可能只是赛道方向需要微调",
  "如果对结果有疑问，可以拨打 12333 公共就业服务热线咨询",
];

// 应届毕业生：保留 career-report 已有的校招友好语气
const TIPS_GRADUATE: string[] = [
  "正在分析你的能力雷达和岗位匹配，这通常需要 30 秒到 1 分钟",
  "好的开始是成功的一半，你已经做了第一步",
  "终面前 48 小时完成简历 V3 版本，V2 发给至少 1 位行业前辈过一遍",
  "薪资谈判前把意向公司同级别员工的总包做一次横向对比",
  "AI 应用经验能撬动 10-20% 的薪资空间，有成果就敢要",
  "校招季平均每人投 20+ 岗位、进终面 3-5 家，一两次拒绝不说明能力问题",
];

function pickTips(identity: UserIdentity | null): string[] {
  if (identity === "recent_grad") return TIPS_GRADUATE;
  return TIPS_JOBSEEKER;
}

/**
 * 轮播职业小贴士：每 4 秒切下一条，淡入淡出。
 * 初始索引随机，避免每次进页都从第 1 条开始。
 */
function RotatingTips({ identity }: { identity: UserIdentity | null }) {
  const tips = pickTips(identity);
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * tips.length));
  useEffect(() => {
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % tips.length);
    }, 4000);
    return () => clearInterval(id);
  }, [tips.length]);

  const tagLabel = identity === "recent_grad" ? "求职路上的小提示" : "陪你慢慢来";

  return (
    <div className="relative rounded-2xl border border-[var(--blue-200)] bg-gradient-to-br from-white via-[var(--blue-50)]/40 to-white p-4 sm:p-5 overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--blue-400)] to-transparent" />
      <div className="flex items-start gap-3">
        <div className="shrink-0 size-8 rounded-full bg-gradient-to-br from-[var(--blue-400)] to-[var(--blue-600)] flex items-center justify-center shadow-sm">
          <Sparkles className="size-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold tracking-[0.18em] uppercase text-[var(--blue-600)] mb-1">
            {tagLabel}
          </div>
          <div className="relative h-[52px] sm:h-[44px]">
            <AnimatePresence mode="wait">
              <motion.p
                key={idx}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: cubicEase }}
                className="absolute inset-0 text-[13px] sm:text-sm leading-[1.65] text-[var(--navy-800)]"
              >
                {tips[idx]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-center gap-1">
        {tips.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-0.5 rounded-full transition-all duration-500",
              i === idx
                ? "w-6 bg-[var(--blue-500)]"
                : "w-1.5 bg-[var(--blue-200)]"
            )}
          />
        ))}
      </div>
    </div>
  );
}

// ===== 圆环进度 =====

function CircularProgress({
  pct,
  done,
}: {
  pct: number;
  done: boolean;
}) {
  const size = 180;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--blue-100)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-gradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.5, ease: cubicEase }}
        />
        <defs>
          <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--blue-400)" />
            <stop offset="100%" stopColor="var(--blue-600)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {done ? (
          <CheckCircle2 className="size-10 text-emerald-500" />
        ) : (
          <>
            <div className="text-3xl font-semibold tracking-tight text-[var(--navy-950)] tabular-nums">
              {Math.round(pct)}
              <span className="text-base text-[var(--muted-foreground)] ml-0.5">
                %
              </span>
            </div>
            <div className="mt-1 text-[11px] tracking-[0.18em] uppercase text-[var(--blue-600)]">
              ANALYZING
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ===== 5 个 section 状态点 =====

function SectionStatusList({ progress }: { progress: SectionProgress[] }) {
  const map = new Map(progress.map((p) => [p.key, p]));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
      {DISPLAY_ORDER.map((key) => {
        const p = map.get(key);
        const status: SectionStatus = p?.status ?? "pending";
        return (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: cubicEase }}
            className={cn(
              "flex sm:flex-col items-center sm:items-center gap-3 sm:gap-2 px-3 py-2.5 sm:py-3 rounded-xl border transition-colors",
              status === "loading" &&
                "border-[var(--blue-300)] bg-[var(--blue-50)]/70",
              status === "completed" && "border-emerald-200 bg-emerald-50/40",
              status === "fallback" && "border-amber-200 bg-amber-50/40",
              status === "skipped" && "border-[var(--blue-100)] bg-white/60",
              status === "pending" &&
                "border-[var(--blue-100)] bg-white/40"
            )}
          >
            <StatusDot status={status} />
            <div className="flex-1 sm:flex-none flex sm:flex-col items-center sm:items-center justify-between sm:justify-start gap-2 sm:gap-0.5 min-w-0 w-full">
              <span className="text-[13px] sm:text-xs font-medium text-[var(--navy-800)] sm:text-center truncate">
                {SECTION_LABELS[key]}
              </span>
              <span className="shrink-0 text-[10px] sm:text-[10px] text-[var(--muted-foreground)] sm:text-center">
                {shortStatusText(status)}
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: SectionStatus }) {
  // 待加载灰 / 加载中蓝 / 已完成绿 / 失败兜底黄 / 跳过浅灰
  const base = "size-7 rounded-full flex items-center justify-center shrink-0";
  if (status === "completed") {
    return (
      <div className={cn(base, "bg-emerald-500")}>
        <CheckCircle2 className="size-4 text-white" />
      </div>
    );
  }
  if (status === "fallback") {
    return (
      <div className={cn(base, "bg-amber-400")}>
        <AlertTriangle className="size-4 text-white" />
      </div>
    );
  }
  if (status === "loading") {
    return (
      <div className={cn(base, "bg-[var(--blue-500)]")}>
        <Loader2 className="size-4 animate-spin text-white" />
      </div>
    );
  }
  if (status === "skipped") {
    return (
      <div className={cn(base, "bg-[var(--blue-100)]")}>
        <Circle className="size-3 text-[var(--blue-400)]" />
      </div>
    );
  }
  return (
    <div className={cn(base, "bg-[var(--blue-100)]/70")}>
      <Circle className="size-3 text-[var(--muted-foreground)]" />
    </div>
  );
}

function shortStatusText(status: SectionStatus): string {
  switch (status) {
    case "pending":
      return "等待中";
    case "loading":
      return "生成中";
    case "completed":
      return "已完成";
    case "fallback":
      return "示例兜底";
    case "skipped":
      return "已跳过";
    default:
      return "";
  }
}

// ===== 全 mock 兜底（超时按钮使用）=====

function buildMockReport(
  formData: JobFormData,
  scoring: ScoringResult,
  interviewQ1Q2: { Q1?: string; Q2?: string }
): ReportData {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      formData,
      scoring,
      hasResume: Boolean(formData.resumeText && formData.resumeText.length > 50),
      interviewQ1Q2,
    },
    overview: MOCK_OVERVIEW,
    strength: MOCK_STRENGTH,
    positioning: MOCK_POSITIONING,
    resumeDiagnosis:
      formData.resumeText && formData.resumeText.length >= 50
        ? MOCK_RESUME_DIAGNOSIS
        : null,
    advice: MOCK_ADVICE,
  };
}

// ===== 主页面 =====

export default function LoadingPage() {
  const router = useRouter();
  const [progress, setProgress] = useState<SectionProgress[]>([]);
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [phase, setPhase] = useState<
    "loading" | "done" | "timeout" | "fatal"
  >("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 超时按钮点了之后再点击会触发"用 mock"，需要保存 payload
  const payloadRef = useRef<{
    formData: JobFormData;
    scoring: ScoringResult;
    quizAnswers: QuizAnswer[];
    interviewQ1Q2: { Q1?: string; Q2?: string };
  } | null>(null);
  const started = useRef(false);
  const timeoutTimer = useRef<number | null>(null);
  // phase 的镜像 ref，让 async resolve 时能拿到最新 phase 判断要不要跳转
  const phaseRef = useRef<"loading" | "done" | "timeout" | "fatal">("loading");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // 后台预编译 /report 路由
    router.prefetch("/report");

    // ---------- 1. 读 sessionStorage ----------
    let formData: JobFormData | null = null;
    let scoring: ScoringResult | null = null;
    let quizAnswers: QuizAnswer[] = [];
    let interviewQ1Q2: { Q1?: string; Q2?: string; Q3?: string } = {};

    try {
      const fdStr = sessionStorage.getItem("formData");
      const scStr = sessionStorage.getItem("scoring");
      const qaStr = sessionStorage.getItem("quizAnswers");
      // interviewQ1Q2 由 interview 页 Q3 答完时写入（含 Q1+Q2+Q3）
      const ivStr = sessionStorage.getItem("interviewQ1Q2");
      // interviewData 含 summary（兜底）
      const idStr = sessionStorage.getItem("interviewData");

      if (!fdStr || !scStr) {
        // 没有 formData 或 scoring → 用户没走 form/quiz 流程，跳回 form
        router.replace("/form");
        return;
      }
      formData = JSON.parse(fdStr) as JobFormData;
      scoring = JSON.parse(scStr) as ScoringResult;
      if (!formData?.targetPosition || !scoring?.fourDim) {
        router.replace("/form");
        return;
      }
      quizAnswers = qaStr ? (JSON.parse(qaStr) as QuizAnswer[]) : [];

      // 优先用 interviewQ1Q2 key（由 Q3 触发时写入，含 Q1+Q2+Q3）
      if (ivStr) {
        try {
          const parsed = JSON.parse(ivStr) as {
            Q1?: string;
            Q2?: string;
            Q3?: string;
          };
          interviewQ1Q2 = {
            Q1: parsed.Q1 || undefined,
            Q2: parsed.Q2 || undefined,
            Q3: parsed.Q3 || undefined,
          };
        } catch {
          /* ignore parse error */
        }
      }

      // 兜底：从 interviewData.summary 提取 Q1（用于跳过访谈的情况）
      if (!interviewQ1Q2.Q1 && idStr) {
        try {
          const parsed = JSON.parse(idStr) as { summary?: string };
          if (parsed.summary) {
            interviewQ1Q2 = { Q1: parsed.summary };
          }
        } catch {
          /* ignore parse error */
        }
      }
    } catch {
      router.replace("/form");
      return;
    }

    if (!formData || !scoring) return;

    setIdentity(formData.identity);
    payloadRef.current = {
      formData,
      scoring,
      quizAnswers,
      interviewQ1Q2,
    };

    // ---------- 2. 启动 90s 超时 ----------
    timeoutTimer.current = window.setTimeout(() => {
      setPhase((cur) => (cur === "loading" ? "timeout" : cur));
    }, TIMEOUT_MS);

    // ---------- 3. 调 consumeAll ----------
    // consumeAll 内部会：
    //   - 调 consumeBgSections() 取 bg-runner 内存 promise（命中即用）
    //   - 内存 miss → 现场 fetch（fallbackPayload + interviewQ1Q2）
    //   - fetch 失败 → mock fallback（progress.status = "fallback"）
    // 因此这里不用再手写"内存 miss + ss 标记"的状态机，consumeAll 已统一处理。
    const startTime = Date.now();
    (async () => {
      try {
        const report = await consumeAll(formData!, quizAnswers, scoring!, {
          onProgress: (p) => setProgress(p),
          interviewQ1Q2,
          fallbackPayload: {
            formData: formData!,
            quizAnswers,
            scoring: scoring!,
            interviewQ1Q2,
          },
        });

        // 超时已触发：用户已经看到 timeout UI（可能也点了"使用示例报告"已跳走）
        // 不再自动跳转，让用户自己决定
        if (phaseRef.current === "timeout") return;

        sessionStorage.setItem("reportData", JSON.stringify(report));
        // finalize 落库（失败不阻塞跳转）
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            formData,
            quizAnswers,
            reportData: report,
            sectionsStatus: {},
            durationMs: Date.now() - startTime,
            resumeRef: sessionStorage.getItem("resumeRef") ?? undefined,
            resumeFilename:
              sessionStorage.getItem("resumeFilename") ?? undefined,
          }),
        }).catch((e) => console.warn("[finalize] failed (ignored):", e));

        if (timeoutTimer.current !== null) {
          window.clearTimeout(timeoutTimer.current);
          timeoutTimer.current = null;
        }
        setPhase("done");
        // 0.7s 后跳，让"已完成"动画看一眼
        window.setTimeout(() => router.push("/report"), 700);
      } catch (e) {
        // consumeAll 内部已有 mock fallback，理论上不会到这里。
        // 万一抛出了（如 sessionStorage 写失败），跳 /report 让 page 自身的 mock 兜底
        console.error("[loading] consumeAll unexpected error:", e);
        setErrorMsg(e instanceof Error ? e.message : "报告生成失败");
        setPhase("fatal");
        // 3 秒后强制跳 /report，让 report page 的 mock 兜底渲染
        window.setTimeout(() => router.push("/report"), 3000);
      }
    })();

    return () => {
      if (timeoutTimer.current !== null) {
        window.clearTimeout(timeoutTimer.current);
        timeoutTimer.current = null;
      }
    };
  }, [router]);

  // 完成数：completed / fallback / skipped 都算"该模块已经有结果可渲染"
  const completedCount = progress.filter(
    (p) =>
      p.status === "completed" ||
      p.status === "fallback" ||
      p.status === "skipped"
  ).length;
  const total = 5;
  const pct = phase === "done" ? 100 : (completedCount / total) * 100;

  // ---------- 超时处理：示例报告按钮 ----------
  const handleUseMock = () => {
    const p = payloadRef.current;
    if (!p) {
      router.replace("/form");
      return;
    }
    const mock = buildMockReport(p.formData, p.scoring, p.interviewQ1Q2);
    try {
      sessionStorage.setItem("reportData", JSON.stringify(mock));
      // 标记是示例数据，让 report page 可以显示提示
      sessionStorage.setItem("reportDataIsMock", "1");
    } catch {
      /* ignore */
    }
    router.push("/report");
  };

  const handleRetry = () => {
    // 清掉超时态，重新进 loading（最简单：reload）
    window.location.reload();
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="fixed inset-0 bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)]" />
      <div className="fixed inset-0 hero-grid opacity-40" />
      <div className="fixed top-20 -right-32 w-96 h-96 rounded-full bg-gradient-to-br from-[var(--blue-200)] to-[var(--blue-100)] opacity-40 blur-3xl" />
      <div className="fixed -bottom-20 -left-32 w-80 h-80 rounded-full bg-gradient-to-tr from-[var(--blue-300)] to-[var(--blue-100)] opacity-30 blur-3xl" />

      <div className="relative z-10 max-w-xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: cubicEase }}
          className="mb-6"
        >
          <StepIndicator currentStep={3} compact />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: cubicEase, delay: 0.05 }}
          className="text-center mb-6"
        >
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--navy-950)] tracking-tight mb-2">
            正在生成你的定位报告
          </h1>
          <p className="text-[13px] sm:text-sm text-[var(--muted-foreground)]">
            评估包含 5 个模块，部分模块在答题阶段已开始预热
          </p>
        </motion.div>

        {/* 圆环进度 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: cubicEase, delay: 0.1 }}
          className="flex flex-col items-center mb-6 sm:mb-8"
        >
          <CircularProgress pct={pct} done={phase === "done"} />
          <div className="mt-4 text-sm text-[var(--muted-foreground)]">
            已完成 <span className="font-semibold text-[var(--navy-800)] tabular-nums">{completedCount}</span> / {total}
          </div>
        </motion.div>

        {/* 5 个 section 状态点 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: cubicEase, delay: 0.15 }}
          className="mb-5"
        >
          <SectionStatusList progress={progress} />
        </motion.div>

        {/* 轮播 tips */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, ease: cubicEase, delay: 0.2 }}
        >
          <RotatingTips identity={identity} />
        </motion.div>

        {/* 超时提示 */}
        {phase === "timeout" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: cubicEase }}
            className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-amber-900 mb-1">
                  AI 服务有点繁忙
                </div>
                <div className="text-[13px] text-amber-800 leading-relaxed mb-3">
                  生成时间已超过 90 秒，可能是当前访问量较大。你可以选择：
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={handleUseMock}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2.5 transition-colors"
                  >
                    使用示例报告查看
                  </button>
                  <button
                    onClick={handleRetry}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white hover:bg-amber-50 text-amber-800 text-sm font-medium px-4 py-2.5 transition-colors"
                  >
                    <RefreshCw className="size-4" />
                    重新生成
                  </button>
                </div>
                <div className="mt-2 text-[11px] text-amber-700">
                  示例报告仅供查看页面结构，不基于你的真实信息生成
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* 致命错误（极少触发，consumeAll 内部已 mock 兜底）*/}
        {phase === "fatal" && errorMsg && (
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="text-sm">
              <div className="font-medium text-destructive mb-1">
                报告生成出错，正在跳转到示例页面…
              </div>
              <div className="text-xs text-muted-foreground">{errorMsg}</div>
            </div>
          </div>
        )}

        {phase === "done" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="mt-5 text-center text-sm text-emerald-600"
          >
            报告已生成，正在跳转…
          </motion.div>
        )}
      </div>
    </div>
  );
}
