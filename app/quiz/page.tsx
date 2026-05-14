"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/ui/step-indicator";
import { cn } from "@/lib/utils";
import { scoreQuiz } from "@/lib/scoring";
import {
  startQuizStream,
  getQuizStreamSnapshot,
  subscribeQuizStream,
  clearQuizStream,
} from "@/lib/quiz-prefetch";
import { startAfterQuiz } from "@/lib/report-bg-runner";
import type { JobFormData, QuizAnswer, QuizQuestion } from "@/lib/types";

const cubicEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

const AUTO_NEXT_DELAY_MS = 400;

const EXPECTED_TOTAL = 8;

const BADGE_INACTIVE = "bg-[var(--blue-100)] text-[var(--blue-600)]";
const BADGE_ACTIVE   = "bg-[var(--blue-500)] text-white";

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
  const [streamDone, setStreamDone] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const autoNextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentIdxRef = useRef(0);
  const questionsRef = useRef<QuizQuestion[]>([]);
  const waitingForNextRef = useRef(false);

  questionsRef.current = questions;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fd = readFormData();
    if (!fd) {
      try {
        sessionStorage.setItem("quizRedirectReason", "请先填写岗位与背景信息");
      } catch {}
      router.replace("/");
      return;
    }
    setFormData(fd);
    router.prefetch("/interview");

    if (!getQuizStreamSnapshot(fd)) {
      startQuizStream(fd);
    }

    const sync = () => {
      const s = getQuizStreamSnapshot(fd);
      if (!s) return;
      setQuestions([...s.questions]);
      setStreamDone(s.done);
      setStreamError(s.error);
    };

    sync();
    const unsub = subscribeQuizStream(fd, sync);

    return unsub;
  }, [router, retryCount]);

  useEffect(() => {
    currentIdxRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    return () => {
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    };
  }, []);

  // Auto-advance when blocked user gets their next question
  useEffect(() => {
    if (!waitingForNextRef.current) return;
    const idx = currentIdxRef.current;
    if (idx + 1 < questions.length) {
      waitingForNextRef.current = false;
      setCurrentIndex(idx + 1);
    }
  }, [questions.length]);

  const currentQ = questions[currentIndex];
  const loadedTotal = questions.length;
  const total = streamDone ? loadedTotal : EXPECTED_TOTAL;
  const isLast = streamDone && currentIndex === loadedTotal - 1;
  const needsWaitNext = !isLast && currentIndex >= loadedTotal - 1 && !streamDone;
  const selectedLabel = currentQ ? answers[currentQ.id] : undefined;
  const answeredCount = Object.keys(answers).length;
  const allAnswered =
    streamDone && loadedTotal > 0 && questions.every((q) => answers[q.id]);
  const progressPct = ((currentIndex + 1) / Math.max(total, 1)) * 100;

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

    if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    if (!isLast) {
      autoNextTimerRef.current = setTimeout(() => {
        const qLen = questionsRef.current.length;
        setCurrentIndex((idx) => {
          if (idx + 1 < qLen) {
            waitingForNextRef.current = false;
            return idx + 1;
          }
          waitingForNextRef.current = true;
          return idx;
        });
      }, AUTO_NEXT_DELAY_MS);
    }
  };

  const goPrev = () => {
    if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const goNext = () => {
    if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    if (currentIndex + 1 < loadedTotal) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleSubmit = () => {
    if (!allAnswered || !formData || submitting) return;
    setSubmitting(true);
    try {
      const finalAnswers = persistAnswers(answers, questions);
      const scoring = scoreQuiz(finalAnswers, questions);
      try {
        sessionStorage.setItem("scoring", JSON.stringify(scoring));
        sessionStorage.removeItem("reportData");
      } catch {}
      // 量表完成后立即开始生成 overview / positioning / resumeDiagnosis
      try {
        startAfterQuiz({ formData, quizAnswers: finalAnswers, scoring });
      } catch (e) {
        console.warn("[quiz] startAfterQuiz failed (ignored):", e);
      }
      router.push("/interview?_=" + Date.now());
    } catch (e) {
      console.error("[quiz] submit failed:", e);
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    clearQuizStream();
    setQuestions([]);
    setStreamDone(false);
    setStreamError(null);
    setCurrentIndex(0);
    setAnswers({});
    waitingForNextRef.current = false;
    setRetryCount((c) => c + 1);
  };

  // Loading: stream active but no questions yet
  if (questions.length === 0 && !streamDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)] px-6">
        <div className="flex flex-col items-center gap-4 text-[var(--muted-foreground)]">
          <Loader2 className="size-8 animate-spin text-[var(--blue-500)]" />
          <div className="text-sm text-center">
            <p className="font-medium text-[var(--navy-800)]">即将开始测评</p>
            <p className="text-xs mt-1 text-[var(--muted-foreground)]">正在为你生成个性化题目…</p>
          </div>
        </div>
      </div>
    );
  }

  // Error: stream failed with no questions at all
  if (streamError && questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)] px-6">
        <div className="max-w-md w-full text-center space-y-4">
          <AlertCircle className="mx-auto size-10 text-destructive" />
          <div className="text-lg font-medium text-[var(--navy-900)]">测评加载失败</div>
          <div className="text-sm text-muted-foreground break-words">{streamError}</div>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => router.push("/")}>
              返回填写信息
            </Button>
            <Button
              onClick={handleRetry}
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

              {/* 4 个 SJT 选项 */}
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
                        "min-h-[56px] w-full flex items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all active:scale-[0.98]",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue-500)]/40",
                        active
                          ? "border-[var(--blue-500)] bg-[var(--blue-500)]/5 shadow-[0_0_0_3px_rgba(59,130,246,0.12),0_4px_16px_rgba(59,130,246,0.1)]"
                          : "border-[var(--blue-100)] bg-white/70 hover:border-[var(--blue-300)] hover:bg-white",
                      )}
                    >
                      <span
                        className={cn(
                          "shrink-0 size-7 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-150 mt-0.5",
                          active ? cn(BADGE_ACTIVE, "scale-[1.1]") : BADGE_INACTIVE,
                        )}
                      >
                        {label}
                      </span>

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

                      {active && (
                        <motion.span
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.15, ease: cubicEase }}
                          className="shrink-0 mt-1 text-[var(--blue-500)]"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                            <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
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
              className={cn("h-11 px-5 rounded-xl", currentIndex === 0 && "invisible")}
            >
              上一题
            </Button>

            {!isLast ? (
              <Button
                type="button"
                onClick={goNext}
                disabled={!selectedLabel || submitting || needsWaitNext}
                className="h-11 px-6 rounded-xl bg-[var(--blue-500)] hover:bg-[var(--blue-600)] active:scale-[0.98] transition-all"
              >
                {needsWaitNext ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    生成中
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
                className="h-12 px-7 rounded-xl bg-gradient-to-br from-[var(--blue-500)] to-[var(--blue-700)] hover:brightness-110 active:brightness-95 text-white btn-glow text-base font-medium transition-all duration-300"
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

        {/* 流式生成状态提示 */}
        {!streamDone && questions.length > 0 && questions.length < EXPECTED_TOTAL && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 className="size-3.5 animate-spin text-[var(--blue-500)]" />
            <span>正在为你个性化生成题目（{questions.length}/{EXPECTED_TOTAL}）</span>
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
