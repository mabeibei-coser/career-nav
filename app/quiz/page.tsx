"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/ui/step-indicator";
import { cn } from "@/lib/utils";
import { scoreQuiz } from "@/lib/scoring";
// report-bg-runner：报告生成已改为 Q3 答完后统一触发，quiz 不再预热
import { consumeQuizPrefetch } from "@/lib/quiz-prefetch";
import type { JobFormData, QuizAnswer, QuizQuestion } from "@/lib/types";

const cubicEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

const AUTO_NEXT_DELAY_MS = 400;

/** 期望的总题数：Q1 固定 + Q2-Q8 LLM 生成 */
const EXPECTED_TOTAL = 8;

/** 选项标签显示样式 */
const OPTION_LABEL_COLORS: Record<"A" | "B" | "C" | "D", string> = {
  A: "bg-blue-100 text-blue-700",
  B: "bg-emerald-100 text-emerald-700",
  C: "bg-violet-100 text-violet-700",
  D: "bg-amber-100 text-amber-700",
};

const OPTION_LABEL_ACTIVE_COLORS: Record<"A" | "B" | "C" | "D", string> = {
  A: "bg-blue-500 text-white",
  B: "bg-emerald-500 text-white",
  C: "bg-violet-500 text-white",
  D: "bg-amber-500 text-white",
};

interface AnswerMap {
  [questionId: string]: "A" | "B" | "C" | "D";
}

function readFormData(): JobFormData | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = sessionStorage.getItem("formData");
    if (!saved) return null;
    const parsed = JSON.parse(saved) as JobFormData;
    if (!parsed.identity) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function QuizPage() {
  const router = useRouter();

  const [formData, setFormData] = useState<JobFormData | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Q2-Q8 是否还在 LLM 后台生成（用户可能已开始答 Q1） */
  const [generating, setGenerating] = useState(false);
  /** Q2-Q8 生成失败的错误信息（不阻塞 Q1 答题） */
  const [generatedError, setGeneratedError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const autoNextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 追踪当前题目索引供 timer 回调读取（避免闭包旧值） */
  const currentIdxRef = useRef(0);
  /** 后台个性化题轮询 timer */
  const personalizationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 分两阶段拉题：
   * 1. GET /api/quiz/bank/q1 → 毫秒级拿固定 SJT-01 + SJT-02 立即显示
   * 2. 消费 form 提交时已预触发的 Promise（Layer 3 优化），
   *    或若无预触发则 POST /api/quiz/bank/generated（LLM 生成 SJT-03-08）
   *
   * 用户在做前 2 题时 LLM 在后台生成，有效消除白屏等待。
   */
  const fetchGenerated = useCallback(async (
    fd: JobFormData,
    fixedQs: QuizQuestion[],
    existingPromise?: Promise<QuizQuestion[]>,
  ) => {
    setGenerating(true);
    setGeneratedError(null);
    try {
      let generated: QuizQuestion[];

      if (existingPromise) {
        // 直接消费 form 提交时已在途的 Promise（可能已 resolve，即时返回）
        generated = await existingPromise;
      } else {
        // 无预触发时走常规 fetch
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/quiz/bank/generated`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ formData: fd }),
            cache: "no-store",
          },
        );
        if (!res.ok) {
          let msg = `剩余题目生成失败（HTTP ${res.status}）`;
          try {
            const d = await res.json();
            if (d?.errorMessage) msg = d.errorMessage;
          } catch {}
          throw new Error(msg);
        }
        const data = await res.json();
        generated = (data?.questions ?? []) as QuizQuestion[];
      }

      if (!Array.isArray(generated) || generated.length === 0) {
        throw new Error("剩余题目返回为空");
      }
      const fullList = [...fixedQs, ...generated];
      setQuestions(fullList);
      try {
        sessionStorage.setItem("quizQuestions", JSON.stringify(fullList));
      } catch {}
    } catch (e) {
      setGeneratedError(e instanceof Error ? e.message : "剩余题目生成失败");
    } finally {
      setGenerating(false);
    }
  }, []);

  const fetchBank = useCallback(
    async (fd: JobFormData) => {
      setLoading(true);
      setLoadError(null);
      setGeneratedError(null);
      // 1. 立即拉固定缓冲题 SJT-01 + SJT-02（毫秒级）
      let fixedQs: QuizQuestion[];
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/quiz/bank/q1`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          let msg = `题目加载失败（HTTP ${res.status}）`;
          try {
            const data = await res.json();
            if (data?.errorMessage) msg = data.errorMessage;
          } catch {}
          throw new Error(msg);
        }
        const data = await res.json();
        fixedQs = (data?.questions ?? []) as QuizQuestion[];
        if (!fixedQs.length || !fixedQs[0]?.id) throw new Error("固定题返回为空");
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "题目加载失败");
        setLoading(false);
        return;
      }

      setQuestions(fixedQs);
      try {
        sessionStorage.setItem("quizQuestions", JSON.stringify(fixedQs));
      } catch {}
      setLoading(false);

      // 2. 消费 form 提交时已预触发的 Promise（Layer 3），或新建 fetch
      const prefetchPromise = consumeQuizPrefetch(fd) ?? undefined;
      void fetchGenerated(fd, fixedQs, prefetchPromise);

      // 3. 后台静默等待个性化题（有目标岗位时才启动）
      // 服务端在步骤 2 返回通用题的同时，已经开始后台生成个性化题。
      // 约 30-60s 后轮询：若个性化已生成，则静默替换用户「当前题」之后的所有题，
      // 用户感知不到切换——他们还没看到那些题。
      if (fd.targetPosition?.trim()) {
        const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
        let retryCount = 0;
        const MAX_RETRIES = 3; // 最多重试 3 次（覆盖最慢 ~120s 生成场景）

        const pollPersonalized = async () => {
          try {
            const res = await fetch(`${BASE}/api/quiz/bank/generated`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ formData: fd }),
              cache: "no-store",
            });
            if (!res.ok) return;
            const data = (await res.json()) as { questions?: QuizQuestion[] };
            const personalized = data?.questions ?? [];
            if (!Array.isArray(personalized) || personalized.length < 6) return;

            setQuestions(prev => {
              if (prev.length < EXPECTED_TOTAL) return prev; // 题目未完整加载，跳过
              const currentGenerated = prev.slice(2); // 当前 Q3-Q8
              // 检测是否已切换为个性化版本（题目文本不同）
              const isDifferent = personalized.some(
                (q, i) => q.text !== currentGenerated[i]?.text,
              );
              if (!isDifferent) {
                // 仍是通用题，安排重试
                retryCount++;
                if (retryCount < MAX_RETRIES) {
                  personalizationTimerRef.current = setTimeout(pollPersonalized, 30_000);
                }
                return prev;
              }
              // 个性化题就绪：从「当前题 + 1」开始静默替换（不动已在读的题）
              const replaceFrom = Math.max(currentIdxRef.current + 1, 2);
              if (replaceFrom >= EXPECTED_TOTAL) return prev; // 用户已答完全部题
              const updated = [...prev];
              for (let i = replaceFrom; i < EXPECTED_TOTAL; i++) {
                const p = personalized[i - 2];
                if (p) updated[i] = p;
              }
              return updated;
            });
          } catch {
            // 静默失败，用户继续使用通用题，不影响流程
          }
        };

        // 30s 后首次轮询（服务端个性化生成典型耗时 20-60s）
        personalizationTimerRef.current = setTimeout(pollPersonalized, 30_000);
      }
    },
    [fetchGenerated],
  );

  // mount: 校验 formData → 拉题
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fd = readFormData();
    if (!fd) {
      try {
        window.sessionStorage.setItem("quizRedirectReason", "请先填写岗位与背景信息");
      } catch {}
      router.replace("/");
      return;
    }
    setFormData(fd);
    router.prefetch("/interview");
    // SJT 题目每次由 LLM 生成，不恢复上次答题（避免答案与新题对不上）
    void fetchBank(fd);
  }, [router, fetchBank]);

  // 同步 currentIndex → ref（供 timer 回调读取最新值）
  useEffect(() => {
    currentIdxRef.current = currentIndex;
  }, [currentIndex]);

  // 卸载时清掉 timer
  useEffect(() => {
    return () => {
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
      if (personalizationTimerRef.current) clearTimeout(personalizationTimerRef.current);
    };
  }, []);

  const currentQ = questions[currentIndex];
  /** 实际已加载题数（可能 1 也可能 8） */
  const loadedTotal = questions.length;
  /** 用户感知的总题数：固定为 EXPECTED_TOTAL 让进度条稳定 */
  const total = EXPECTED_TOTAL;
  /** 是否是最后一题（必须 8 题全到位且 currentIndex=7） */
  const isLast = loadedTotal === EXPECTED_TOTAL && currentIndex === EXPECTED_TOTAL - 1;
  /** 是否在 Q1（此时即使 generating 也允许答题） */
  const isFirst = currentIndex === 0;
  /** 是否需要等待 Q2-Q8 加载（用户答完 Q1 但 generated 还没回来） */
  const needsWaitNext = !isLast && currentIndex >= loadedTotal - 1 && generating;
  const selectedLabel = currentQ ? answers[currentQ.id] : undefined;
  const answeredCount = Object.keys(answers).length;
  const allAnswered =
    loadedTotal === EXPECTED_TOTAL && questions.every((q) => answers[q.id]);
  const progressPct = ((currentIndex + 1) / total) * 100;

  const persistAnswers = useCallback(
    (map: AnswerMap, qs: QuizQuestion[]): QuizAnswer[] => {
      const arr: QuizAnswer[] = qs
        .filter((q) => map[q.id])
        .map((q) => ({
          questionId: q.id,
          selectedLabel: map[q.id]!,
        }));
      try {
        sessionStorage.setItem("quizAnswers", JSON.stringify(arr));
      } catch {}
      return arr;
    },
    [],
  );

  const handleSelect = (label: "A" | "B" | "C" | "D") => {
    if (!currentQ || submitting) return;
    const updated = { ...answers, [currentQ.id]: label };
    setAnswers(updated);
    persistAnswers(updated, questions);

    // 最后一题不自动跳；中间题 400ms 后自动跳下题
    if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    if (!isLast) {
      autoNextTimerRef.current = setTimeout(() => {
        // 只在下一题已加载时跳转；否则原地等（needsWaitNext 会显示加载提示）
        setCurrentIndex((idx) =>
          idx + 1 < loadedTotal ? idx + 1 : idx,
        );
      }, AUTO_NEXT_DELAY_MS);
    }
  };

  const goPrev = () => {
    if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const goNext = () => {
    if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    // 下一题尚未加载时不可跳
    if (currentIndex + 1 < loadedTotal) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleSubmit = () => {
    if (!allAnswered || !formData || submitting) return;
    setSubmitting(true);
    try {
      const finalAnswers = persistAnswers(answers, questions);
      // SJT 评分：直接使用当前题目（含选项 weights）
      const scoring = scoreQuiz(finalAnswers, questions);
      try {
        sessionStorage.setItem("scoring", JSON.stringify(scoring));
        sessionStorage.removeItem("reportData");
      } catch {}
      // 报告生成改为 interview Q3 答完后统一触发，这里只跳转
      router.push("/interview?_=" + Date.now());
    } catch (e) {
      console.error("[quiz] submit failed:", e);
      setSubmitting(false);
    }
  };

  // ===== Loading / Error 渲染 =====
  // 此 loading 只覆盖 Q1 的拉取（毫秒级），Q2-Q8 在后台异步生成
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)] px-6">
        <div className="flex flex-col items-center gap-4 text-[var(--muted-foreground)]">
          <Loader2 className="size-8 animate-spin text-[var(--blue-500)]" />
          <div className="text-sm text-center">
            <p className="font-medium text-[var(--navy-800)]">即将开始测评</p>
            <p className="text-xs mt-1 text-[var(--muted-foreground)]">正在准备第一题…</p>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)] px-6">
        <div className="max-w-md w-full text-center space-y-4">
          <AlertCircle className="mx-auto size-10 text-destructive" />
          <div className="text-lg font-medium text-[var(--navy-900)]">测评加载失败</div>
          <div className="text-sm text-muted-foreground break-words">{loadError}</div>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => router.push("/")}>
              返回填写信息
            </Button>
            <Button
              onClick={() => formData && void fetchBank(formData)}
              className="bg-[var(--blue-500)] hover:bg-[var(--blue-600)]"
            >
              重试
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentQ) return null;

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* 背景层 */}
      <div className="fixed inset-0 bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)]" />
      <div className="fixed inset-0 hero-grid opacity-40" />
      <div className="fixed top-20 -right-32 w-96 h-96 rounded-full bg-gradient-to-br from-[var(--blue-200)] to-[var(--blue-100)] opacity-40 blur-3xl" />
      <div className="fixed -bottom-20 -left-32 w-80 h-80 rounded-full bg-gradient-to-tr from-[var(--blue-300)] to-[var(--blue-100)] opacity-30 blur-3xl" />

      {/* 顶部进度条 sticky */}
      <div className="sticky top-0 z-20 backdrop-blur-md bg-white/70 border-b border-[var(--blue-100)]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-3 pb-2">
          <StepIndicator currentStep={1} compact className="mb-2" />
          <div className="flex justify-between items-baseline text-xs text-[var(--muted-foreground)] mb-1.5">
            <span className="font-medium text-[var(--navy-800)]">
              {currentIndex + 1} / {total}
            </span>
            <span>已完成 {answeredCount} / {total}</span>
          </div>
          <div className="h-1.5 bg-[var(--blue-100)] rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[var(--blue-500)] to-[var(--blue-400)]"
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.4, ease: cubicEase }}
            />
          </div>
        </div>
      </div>

      {/* 题面卡片 */}
      <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-[max(7rem,env(safe-area-inset-bottom))]">
        <div className="glass-card rounded-2xl p-5 sm:p-7">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentQ.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: cubicEase }}
            >
              {/* 题干 */}
              <div className="flex items-start gap-3 mb-6">
                <div className="shrink-0 size-9 rounded-full bg-[var(--blue-500)] text-white flex items-center justify-center text-sm font-semibold">
                  Q{currentIndex + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[var(--muted-foreground)] mb-1.5 tracking-wide">
                    情境判断
                  </div>
                  <h2 className="text-[17px] sm:text-[19px] font-semibold leading-relaxed text-[var(--navy-900)]">
                    {currentQ.text}
                  </h2>
                </div>
              </div>

              {/* 4 个 SJT 选项（纵向排列） */}
              <div className="flex flex-col gap-2.5">
                {(["A", "B", "C", "D"] as const).map((label) => {
                  const option = currentQ.options.find((o) => o.label === label);
                  if (!option) return null;
                  const active = selectedLabel === label;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => handleSelect(label)}
                      aria-pressed={active}
                      aria-label={`选项 ${label}：${option.text}`}
                      className={cn(
                        "min-h-[56px] w-full flex items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue-500)]/40",
                        active
                          ? "border-[var(--blue-500)] bg-[var(--blue-500)]/5 shadow-sm"
                          : "border-[var(--blue-100)] bg-white/70 hover:border-[var(--blue-300)] hover:bg-white",
                      )}
                    >
                      {/* 选项标签徽章 */}
                      <span
                        className={cn(
                          "shrink-0 size-7 rounded-full flex items-center justify-center text-sm font-bold transition-all mt-0.5",
                          active
                            ? OPTION_LABEL_ACTIVE_COLORS[label]
                            : OPTION_LABEL_COLORS[label],
                        )}
                      >
                        {label}
                      </span>

                      {/* 选项文字 */}
                      <span
                        className={cn(
                          "flex-1 text-[15px] sm:text-base leading-relaxed",
                          active
                            ? "text-[var(--navy-900)] font-medium"
                            : "text-[var(--navy-800)]",
                        )}
                      >
                        {option.text}
                      </span>

                      {/* 已选 checkmark */}
                      {active && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ duration: 0.15, ease: cubicEase }}
                          className="shrink-0 mt-0.5 text-[var(--blue-500)]"
                        >
                          ✓
                        </motion.span>
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>

          {/* 底部导航 */}
          <div className="mt-7 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={goPrev}
              disabled={currentIndex === 0 || submitting}
              className={cn("h-11 px-5", currentIndex === 0 && "invisible")}
            >
              上一题
            </Button>

            {!isLast ? (
              <Button
                type="button"
                onClick={goNext}
                disabled={!selectedLabel || submitting || needsWaitNext}
                className="h-11 px-6 bg-[var(--blue-500)] hover:bg-[var(--blue-600)]"
              >
                {needsWaitNext ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    等待出题
                  </>
                ) : (
                  "下一题"
                )}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!allAnswered || submitting}
                className="h-11 px-6 bg-[var(--navy-900)] hover:bg-[var(--navy-800)] text-white"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    提交中
                  </>
                ) : (
                  "提交并进入访谈"
                )}
              </Button>
            )}
          </div>
        </div>

        {/* 剩余题目生成状态提示（非阻塞）*/}
        {generating && currentIndex < 2 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 className="size-3.5 animate-spin text-[var(--blue-500)]" />
            <span>正在为你个性化定制后 6 道题，可先答前 2 题…</span>
          </div>
        )}
        {generatedError && !generating && (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50/70 px-4 py-3 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4" />
              <span>剩余题目生成失败：{generatedError}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => formData && void fetchGenerated(formData, questions.slice(0, 2))}
            >
              重新生成
            </Button>
          </div>
        )}

        {/* Tips */}
        <p className="text-center text-xs text-[var(--muted-foreground)] mt-6 leading-relaxed">
          测评无对错，选最符合你实际的做法即可；
          <br className="sm:hidden" />
          可点"上一题"返回修改。
          {formData?.resumeFileName && (
            <span className="block mt-1">已识别简历：{formData.resumeFileName}</span>
          )}
        </p>
      </div>
    </div>
  );
}
