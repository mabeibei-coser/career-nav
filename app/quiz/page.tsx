"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/ui/step-indicator";
import { cn } from "@/lib/utils";
import { scoreQuiz } from "@/lib/scoring";
import { startAfterQuiz } from "@/lib/report-bg-runner";
import type { JobFormData, QuizAnswer, QuizQuestion } from "@/lib/types";

const cubicEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

const AUTO_NEXT_DELAY_MS = 400;

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
  const [submitting, setSubmitting] = useState(false);
  const autoNextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 拉题（POST /api/quiz/bank，携带完整 formData 做个性化生成）
  const fetchBank = useCallback(async (fd: JobFormData) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/quiz/bank`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ formData: fd }),
          cache: "no-store",
        },
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
      const list = (data?.questions ?? []) as QuizQuestion[];
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error("测评题目返回为空，请稍后重试");
      }
      setQuestions(list);
      // 题目也存一份到 sessionStorage，方便 handleSubmit 在极端情况下访问
      try {
        sessionStorage.setItem("quizQuestions", JSON.stringify(list));
      } catch {}
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "题目加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // mount: 校验 formData → 拉题
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fd = readFormData();
    if (!fd) {
      try {
        window.sessionStorage.setItem("quizRedirectReason", "请先填写岗位与背景信息");
      } catch {}
      router.replace("/form");
      return;
    }
    setFormData(fd);
    router.prefetch("/interview");
    // SJT 题目每次由 LLM 生成，不恢复上次答题（避免答案与新题对不上）
    void fetchBank(fd);
  }, [router, fetchBank]);

  // 卸载时清掉自动跳题定时器
  useEffect(() => {
    return () => {
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    };
  }, []);

  const currentQ = questions[currentIndex];
  const total = questions.length;
  const isLast = total > 0 && currentIndex === total - 1;
  const selectedLabel = currentQ ? answers[currentQ.id] : undefined;
  const answeredCount = Object.keys(answers).length;
  const allAnswered = total > 0 && questions.every((q) => answers[q.id]);
  const progressPct = total > 0 ? ((currentIndex + 1) / total) * 100 : 0;

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
        setCurrentIndex((idx) => Math.min(idx + 1, total - 1));
      }, AUTO_NEXT_DELAY_MS);
    }
  };

  const goPrev = () => {
    if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const goNext = () => {
    if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    if (currentIndex < total - 1) setCurrentIndex(currentIndex + 1);
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
      // 触发后台生成 strength / positioning / advice
      startAfterQuiz({ formData, quizAnswers: finalAnswers, scoring });
      router.push("/interview");
    } catch (e) {
      console.error("[quiz] submit failed:", e);
      setSubmitting(false);
    }
  };

  // ===== Loading / Error 渲染 =====
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)] px-6">
        <div className="flex flex-col items-center gap-4 text-[var(--muted-foreground)]">
          <Loader2 className="size-8 animate-spin text-[var(--blue-500)]" />
          <div className="text-sm text-center">
            <p className="font-medium text-[var(--navy-800)]">正在为你生成专属测评题目</p>
            <p className="text-xs mt-1 text-[var(--muted-foreground)]">根据你的背景个性化定制，约需 5-15 秒</p>
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
            <Button variant="outline" onClick={() => router.push("/form")}>
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
                disabled={!selectedLabel || submitting}
                className="h-11 px-6 bg-[var(--blue-500)] hover:bg-[var(--blue-600)]"
              >
                下一题
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
