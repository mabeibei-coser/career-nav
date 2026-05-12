"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ListChecks, Mic, Sparkles } from "lucide-react";
import { AiOrb } from "@/app/interview/_components/ai-orb";
import { useAudioPlayer } from "@/lib/hooks/use-audio-player";
import { Button } from "@/components/ui/button";
import type { InterviewQuestion, JobFormData } from "@/lib/types";

// AI 助理开场白（会被 TTS 朗读）
const INTRO_TEXT =
  "你好，我是你的 AI 职业定位助理。接下来我们一起完成两个环节：第一，为你定制的性格测试量表；第二，AI 语音访谈。你准备好了吗？准备好了，我们就开始测评。";

const cubicEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * iOS Safari / Android Chrome 首次 audio.play() 会被静默拦截（autoplay policy）。
 * 在用户手势栈里播一段极短静音 MP3，触发 AudioContext 解锁 + 激活 MediaSession，
 * 避免后续 TTS 首段音量偏低。与 interview/page.tsx 的实现保持一致。
 */
function unlockAudio() {
  try {
    const a = new Audio(
      "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZgAAAA8AAAACAAACcQCA",
    );
    a.volume = 1.0;
    a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

export default function IntroPage() {
  const router = useRouter();
  const [ttsAudio, setTtsAudio] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const player = useAudioPlayer(() => setIsSpeaking(false));

  // 守卫 + 后台预合成 intro TTS + 后台预热 interview Q1Q2
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

    // 1) 预合成本页 AI 助理开场白
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
      .catch(() => {
        // 静默降级：屏幕上文字依然能读到
      });

    // 2) 后台预热 interview Q1Q2（route 内含 TTS 合成，返回 audioBase64）
    //    Q1Q2 仅依赖 formData，不依赖 quiz 答案，可提前。
    //    用 sessionStorage 跨页面传递；interview 页 mount 时优先消费。
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

  // TTS 就绪 → 尝试 autoplay（iOS 上可能被拦截，静默失败）
  useEffect(() => {
    if (!ttsAudio) return;
    setIsSpeaking(true);
    player.play(ttsAudio);
    setTtsAudio(null);
  }, [ttsAudio, player]);

  /**
   * CTA 点击：必须保持调用链 **同步**，否则 iOS Safari 会丢失用户手势：
   *   unlockAudio()   → 同步，激活 audio session
   *   getUserMedia()  → 同步调用、异步 resolve（promise 在用户手势栈里发起就 OK）
   * promise 完成后再 router.push，避免 mic 弹窗出现在 quiz 页（体验割裂）。
   */
  const handleStart = () => {
    if (submitting) return;
    setSubmitting(true);
    player.stop();
    unlockAudio();

    if (!navigator.mediaDevices?.getUserMedia) {
      sessionStorage.setItem("micPermission", "unsupported");
      router.push("/quiz");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        // 立即释放 track —— 仅为获取权限。session 内权限保持，
        // interview 页再次 getUserMedia 不会再弹窗。
        stream.getTracks().forEach((t) => t.stop());
        sessionStorage.setItem("micPermission", "granted");
      })
      .catch(() => {
        // 拒绝 / 不可用 → interview 页直接降级到文字输入
        sessionStorage.setItem("micPermission", "denied");
      })
      .finally(() => {
        router.push("/quiz");
      });
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* 与 form / preparing 同色系背景 */}
      <div className="fixed inset-0 bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)]" />
      <div className="fixed inset-0 hero-grid opacity-40" />
      <div className="fixed top-20 -right-32 w-96 h-96 rounded-full bg-gradient-to-br from-[var(--blue-200)] to-[var(--blue-100)] opacity-40 blur-3xl" />
      <div className="fixed -bottom-20 -left-32 w-80 h-80 rounded-full bg-gradient-to-tr from-[var(--blue-300)] to-[var(--blue-100)] opacity-30 blur-3xl" />

      <div className="relative z-10 min-h-screen flex flex-col items-center px-5 py-6 sm:py-8">
        {/* 蓝色光球 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.75, ease: cubicEase }}
          className="mt-4 sm:mt-8 mb-4 sm:mb-5"
          aria-hidden
        >
          <AiOrb state={isSpeaking ? "speaking" : "idle"} size={172} />
        </motion.div>

        {/* 主标题 */}
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: cubicEase, delay: 0.2 }}
          className="text-xl sm:text-2xl font-bold text-[var(--navy-900)] mb-2 tracking-tight text-center px-2"
        >
          你好，我是你的 AI 职业定位助理
        </motion.h1>

        {/* 副标题 */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: cubicEase, delay: 0.32 }}
          className="text-sm text-[var(--muted-foreground)] mb-7 sm:mb-8 text-center"
        >
          接下来我们一起完成两个环节
        </motion.p>

        {/* 两步卡片 */}
        <div className="w-full max-w-md space-y-3">
          <StepCard
            index={0}
            Icon={ListChecks}
            badge="01"
            title={
              <>
                <span className="text-[var(--blue-600)]">定制</span>
                性格测试量表
                <Sparkles
                  className="inline-block ml-1.5 size-3.5 text-[var(--blue-400)] -translate-y-px"
                  strokeWidth={2.2}
                />
              </>
            }
            subtitle="8 道量表题"
          />
          <StepCard
            index={1}
            Icon={Mic}
            badge="02"
            title="AI 语音访谈"
            subtitle="开放式对话"
          />
        </div>

        {/* 结果说明 */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="text-xs sm:text-sm text-[var(--muted-foreground)] mt-6 mb-7 text-center max-w-sm leading-relaxed"
        >
          这两个环节完成之后，将为你生成完整的评估报告
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: cubicEase, delay: 0.8 }}
          className="w-full max-w-md pb-[max(1rem,env(safe-area-inset-bottom))]"
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

function StepCard({
  index,
  Icon,
  badge,
  title,
  subtitle,
}: {
  index: number;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  badge: string;
  title: React.ReactNode;
  subtitle: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: cubicEase, delay: 0.45 + index * 0.1 }}
      className="glass-card rounded-xl p-4 sm:p-5 flex items-center gap-4 relative overflow-hidden"
    >
      {/* 左侧 icon */}
      <div className="shrink-0 size-12 rounded-xl bg-gradient-to-br from-[var(--blue-500)] to-[var(--blue-400)] text-white flex items-center justify-center shadow-md shadow-blue-500/15 relative">
        <Icon className="size-5 relative z-10" strokeWidth={1.8} />
        {/* 微光晕 */}
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
      </div>

      {/* 中间文案 */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] tracking-[0.18em] font-bold text-[var(--blue-500)]/70 font-mono mb-1">
          {badge}
        </div>
        <div className="text-base sm:text-[17px] font-semibold text-[var(--navy-900)] leading-snug">
          {title}
        </div>
        <div className="text-xs sm:text-sm text-[var(--muted-foreground)] mt-1">
          {subtitle}
        </div>
      </div>
    </motion.div>
  );
}
