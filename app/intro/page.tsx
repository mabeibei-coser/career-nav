"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ListChecks, Mic } from "lucide-react";
import { useAudioPlayer } from "@/lib/hooks/use-audio-player";
import { playWithBlessedAudio, stopBlessedAudio } from "@/lib/audio-bless";
import { Button } from "@/components/ui/button";
import type { InterviewQuestion, JobFormData } from "@/lib/types";

const INTRO_TEXT =
  "你好，我是你的 AI 职业助理。接下来我们一起完成两个环节：第一，职业导航自测；第二，AI 语音访谈。你准备好了吗？准备好了，我们就开始测评。";

const cubicEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

export default function IntroPage() {
  const router = useRouter();
  const [ttsAudio, setTtsAudio] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const player = useAudioPlayer(() => setIsSpeaking(false));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const formDataStr = sessionStorage.getItem("formData");
    if (!formDataStr) {
      router.replace("/");
      return;
    }
    router.prefetch("/quiz");

    let cancelled = false;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

    fetch(`${base}/api/interview/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: INTRO_TEXT }),
    })
      .then((r) => r.json() as Promise<{ audioBase64?: string }>)
      .then((data) => {
        if (cancelled) return;
        if (data?.audioBase64) setTtsAudio(data.audioBase64);
      })
      .catch(() => {});

    if (!sessionStorage.getItem("interviewQ1Q2")) {
      try {
        const formData = JSON.parse(formDataStr) as JobFormData;
        fetch(`${base}/api/interview/question`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ formData }),
        })
          .then((r) =>
            r.ok ? (r.json() as Promise<{ questions: InterviewQuestion[] }>) : null,
          )
          .then((data) => {
            if (cancelled || !data) return;
            const qs = data.questions;
            if (Array.isArray(qs) && qs.length === 2) {
              sessionStorage.setItem("interviewQ1Q2", JSON.stringify(qs));
            }
          })
          .catch(() => {});
      } catch {
        /* formData 解析失败，忽略 */
      }
    }

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!ttsAudio) return;
    setIsSpeaking(true);
    const played = playWithBlessedAudio(ttsAudio, () => setIsSpeaking(false));
    if (!played) {
      player.play(ttsAudio);
    }
    setTtsAudio(null);
  }, [ttsAudio, player]);

  const handleStart = () => {
    if (submitting) return;
    setSubmitting(true);
    stopBlessedAudio();
    player.stop();
    router.push("/quiz");
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="fixed inset-0 bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)]" />
      <div className="fixed inset-0 hero-grid opacity-40" />
      <div className="fixed top-20 -right-32 w-96 h-96 rounded-full bg-gradient-to-br from-[var(--blue-200)] to-[var(--blue-100)] opacity-40 blur-3xl" />
      <div className="fixed -bottom-20 -left-32 w-80 h-80 rounded-full bg-gradient-to-tr from-[var(--blue-300)] to-[var(--blue-100)] opacity-30 blur-3xl" />

      <div className="relative z-10 min-h-screen flex flex-col items-center px-5 py-6 sm:py-8">
        {/* Soft orb — no hard edges */}
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: cubicEase }}
          className="mt-4 sm:mt-8 mb-4 sm:mb-5"
          aria-hidden
        >
          <SoftOrb speaking={isSpeaking} />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: cubicEase, delay: 0.2 }}
          className="text-xl sm:text-2xl font-bold text-[var(--navy-900)] mb-2 tracking-tight text-center px-2"
        >
          你好，我是你的 AI 职业助理
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: cubicEase, delay: 0.32 }}
          className="text-sm text-[var(--muted-foreground)] mb-7 sm:mb-8 text-center"
        >
          接下来我们一起完成两个环节
        </motion.p>

        {/* Journey flow — single container, timeline layout */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: cubicEase, delay: 0.4 }}
          className="w-full max-w-md mb-auto"
        >
          <div className="relative rounded-2xl bg-white/50 backdrop-blur-sm border border-white/70 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_32px_rgba(59,130,246,0.06)] overflow-hidden">
            {/* Top accent line */}
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[var(--blue-300)]/60 to-transparent" />

            <div className="relative p-5 sm:p-6">
              {/* Step 1 */}
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease: cubicEase, delay: 0.5 }}
                className="flex gap-3.5 relative mb-7"
              >
                <div className="shrink-0 relative z-10">
                  <ListChecks className="size-5 text-[var(--blue-500)]" strokeWidth={1.8} />
                </div>
                <div className="pt-px min-w-0">
                  <span className="inline-block text-[10px] font-mono font-semibold text-[var(--blue-400)]/80 tracking-[0.16em] uppercase mb-1">
                    Step 01
                  </span>
                  <h3 className="text-[15px] sm:text-base font-semibold text-[var(--navy-900)] leading-snug">
                    职业导航自测
                  </h3>
                </div>
              </motion.div>

              {/* Step 2 */}
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease: cubicEase, delay: 0.6 }}
                className="flex gap-3.5 relative"
              >
                <div className="shrink-0 relative z-10">
                  <Mic className="size-5 text-[var(--blue-500)]" strokeWidth={1.8} />
                </div>
                <div className="pt-px min-w-0">
                  <span className="inline-block text-[10px] font-mono font-semibold text-[var(--blue-400)]/80 tracking-[0.16em] uppercase mb-1">
                    Step 02
                  </span>
                  <h3 className="text-[15px] sm:text-base font-semibold text-[var(--navy-900)] leading-snug">
                    AI 语音访谈
                  </h3>
                </div>
              </motion.div>
            </div>

            {/* Outcome footer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.7 }}
              className="px-5 sm:px-6 py-3 bg-[var(--blue-50)]/40 border-t border-[var(--blue-100)]/40 flex items-center justify-center gap-2"
            >
              <svg className="size-3.5 text-[var(--blue-400)]" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M2 14h12M4 10h8M6 6h4M7.5 2h1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-xs text-[var(--muted-foreground)]">
                完成后将为您生成个性化职业导航报告
              </span>
            </motion.div>
          </div>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: cubicEase, delay: 0.8 }}
          className="w-full max-w-md mt-7 pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <Button
            onClick={handleStart}
            disabled={submitting}
            className="w-full h-12 text-base font-medium bg-[var(--navy-900)] hover:bg-[var(--navy-800)] text-white rounded-xl btn-glow transition-all duration-300 disabled:opacity-75 disabled:cursor-wait"
          >
            <span className="flex items-center gap-2">
              {submitting ? (
                <>
                  <svg
                    className="size-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeOpacity="0.25"
                      strokeWidth="2.5"
                    />
                    <path
                      d="M22 12a10 10 0 0 1-10 10"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  正在准备测评…
                </>
              ) : (
                <>
                  准备好了，开始测评
                  <ArrowRight className="size-4" strokeWidth={2} />
                </>
              )}
            </span>
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

/** Soft-edged orb with layered radial gradients — no overflow:hidden clipping. */
function SoftOrb({ speaking }: { speaking: boolean }) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: 186, height: 186 }}
    >
      {/* Ambient pulse glow */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 270,
          height: 270,
          background:
            "radial-gradient(circle, rgba(59,130,246,0.13) 0%, rgba(59,130,246,0.04) 50%, transparent 72%)",
        }}
        animate={{ scale: speaking ? [1, 1.14, 1] : [1, 1.05, 1] }}
        transition={{
          duration: speaking ? 2.4 : 5.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Core sphere */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 152,
          height: 152,
          background: [
            "radial-gradient(ellipse 80% 75% at 38% 32%, rgba(255,255,255,0.55) 0%, transparent 50%)",
            "radial-gradient(circle at 52% 52%, oklch(78% 0.14 250) 0%, oklch(72% 0.12 248) 28%, oklch(84% 0.07 240) 58%, oklch(93% 0.03 236) 82%, transparent 100%)",
          ].join(","),
          boxShadow:
            "0 0 50px rgba(59,130,246,0.22), 0 0 100px rgba(59,130,246,0.08)",
        }}
        animate={{ scale: speaking ? [1, 1.05, 1] : [1, 1.015, 1] }}
        transition={{
          duration: speaking ? 2.2 : 5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Secondary color drift */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 128,
          height: 128,
          background: [
            "radial-gradient(ellipse 120% 100% at 65% 60%, oklch(65% 0.18 260 / 0.45) 0%, transparent 55%)",
            "radial-gradient(ellipse 100% 120% at 28% 72%, oklch(70% 0.15 238 / 0.35) 0%, transparent 50%)",
          ].join(","),
        }}
        animate={{
          rotate: speaking ? [0, 25, 0] : [0, 8, 0],
          scale: speaking ? [1, 1.07, 1] : [1, 1.02, 1],
        }}
        transition={{
          duration: speaking ? 3.5 : 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Specular highlight */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 65,
          height: 40,
          top: "28%",
          left: "22%",
          background:
            "radial-gradient(ellipse, rgba(255,255,255,0.4) 0%, transparent 72%)",
          filter: "blur(5px)",
        }}
      />
    </div>
  );
}
