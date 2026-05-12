"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Briefcase, Sparkles } from "lucide-react";

const cubicEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

const STEPS = [
  { key: "resume", label: "正在分析您的简历", Icon: FileText },
  { key: "jobs", label: "正在匹配岗位信息", Icon: Briefcase },
  { key: "quiz", label: "正在为您定制测评题", Icon: Sparkles },
] as const;

// 时序（ms）— 总 ~6.55s，落在用户要求的 6-8s 区间偏短一侧
const T_ENTRY = 350;
const T_RUNNING = 1500;
const T_DONE_HOLD = 250;
const T_EXIT_DELAY = 400;
const T_EXIT_DURATION = 400;

export default function PreparingPage() {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState(-1);
  const [doneCount, setDoneCount] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // 守卫：没填表单就直接进 /preparing 的，踢回入口
    if (!sessionStorage.getItem("formData")) {
      router.replace("/");
      return;
    }
    router.prefetch("/intro");
    router.prefetch("/quiz");

    const timers: ReturnType<typeof setTimeout>[] = [];
    const sched = (delay: number, fn: () => void) =>
      timers.push(setTimeout(fn, delay));

    let t = T_ENTRY;
    for (let i = 0; i < STEPS.length; i++) {
      sched(t, () => setActiveStep(i));
      t += T_RUNNING;
      sched(t, () => setDoneCount(i + 1));
      t += T_DONE_HOLD;
    }
    t += T_EXIT_DELAY;
    sched(t, () => setExiting(true));
    sched(t + T_EXIT_DURATION, () => router.push("/intro"));

    return () => timers.forEach(clearTimeout);
  }, [router]);

  const progress = doneCount / STEPS.length;

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Layered backgrounds — 与 form 入口同色系 */}
      <div className="fixed inset-0 bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)]" />
      <div className="fixed inset-0 hero-grid opacity-40" />
      <div className="fixed top-20 -right-32 w-96 h-96 rounded-full bg-gradient-to-br from-[var(--blue-200)] to-[var(--blue-100)] opacity-40 blur-3xl" />
      <div className="fixed -bottom-20 -left-32 w-80 h-80 rounded-full bg-gradient-to-tr from-[var(--blue-300)] to-[var(--blue-100)] opacity-30 blur-3xl" />

      <AnimatePresence>
        {!exiting && (
          <motion.div
            key="preparing-shell"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ duration: T_EXIT_DURATION / 1000, ease: cubicEase }}
            className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 py-10"
          >
            {/* Caption + 大标题 */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: cubicEase, delay: 0.05 }}
              className="text-[10px] sm:text-xs tracking-[0.32em] uppercase text-[var(--blue-500)]/75 font-semibold mb-3 flex items-center gap-2"
              aria-hidden
            >
              <span className="inline-block w-6 h-px bg-[var(--blue-400)]/60" />
              Personalizing for You
              <span className="inline-block w-6 h-px bg-[var(--blue-400)]/60" />
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: cubicEase, delay: 0.15 }}
              className="text-xl sm:text-2xl font-bold text-[var(--navy-900)] mb-10 sm:mb-12 tracking-tight text-center"
            >
              正在为您定制专属评估
            </motion.h1>

            {/* 中央 orb */}
            <motion.div
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: cubicEase, delay: 0.1 }}
              className="relative w-44 h-44 sm:w-52 sm:h-52 mb-10 flex items-center justify-center"
            >
              <CentralOrb progress={progress} activeStep={activeStep} />
            </motion.div>

            {/* 当前步骤大字 caption（live region：让 a11y 也能感受到进展） */}
            <div
              className="h-7 mb-7 sm:mb-8 flex items-center justify-center"
              aria-live="polite"
              aria-atomic="true"
            >
              <AnimatePresence mode="wait">
                {activeStep >= 0 && (
                  <motion.div
                    key={`${activeStep}-${doneCount > activeStep ? "done" : "run"}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.32, ease: cubicEase }}
                    className="text-sm sm:text-base font-medium text-[var(--navy-700)] tracking-wide"
                  >
                    {doneCount > activeStep
                      ? `已完成 · ${STEPS[activeStep].label.replace("正在", "")}`
                      : STEPS[activeStep].label}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 三步列表 */}
            <div className="w-full max-w-sm space-y-1.5">
              {STEPS.map((step, i) => (
                <StepRow
                  key={step.key}
                  index={i}
                  step={step}
                  active={activeStep === i && doneCount <= i}
                  done={doneCount > i}
                  pending={activeStep < i}
                />
              ))}
            </div>

            {/* 小尾巴说明 */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.6 }}
              className="mt-10 text-[11px] text-[var(--muted-foreground)]/70 tracking-wide text-center max-w-xs"
            >
              基于你的身份与岗位意向，正在生成专属题目
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── 中央 orb：进度环 + 双层装饰环 + 呼吸光晕 + 中心 disc + active icon ─── */
function CentralOrb({
  progress,
  activeStep,
}: {
  progress: number;
  activeStep: number;
}) {
  const size = 208;
  const stroke = 3;
  const radius = (size - stroke) / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  const Icon = activeStep >= 0 ? STEPS[activeStep].Icon : null;

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {/* Outer breathing glow */}
      <motion.div
        animate={{ scale: [1, 1.1, 1], opacity: [0.55, 0.25, 0.55] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-2 rounded-full bg-gradient-to-br from-[var(--blue-300)] to-[var(--blue-400)] blur-2xl"
      />

      {/* Decorative dashed ring (slow CW) */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
        className="absolute inset-2 rounded-full border border-dashed border-[var(--blue-400)]/40"
      />

      {/* Inner thin ring (slow CCW) */}
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 32, repeat: Infinity, ease: "linear" }}
        className="absolute inset-7 rounded-full border border-[var(--blue-200)]/70"
      />

      {/* Progress arc */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute -rotate-90"
      >
        <defs>
          <linearGradient id="orb-progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--blue-300)" />
            <stop offset="55%" stopColor="var(--blue-500)" />
            <stop offset="100%" stopColor="var(--blue-600)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--blue-100)"
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#orb-progress-gradient)"
          strokeWidth={stroke + 1}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: cubicEase }}
        />
      </svg>

      {/* Inner glassy disc holding the active icon */}
      <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-white/85 backdrop-blur-md shadow-xl shadow-blue-500/15 flex items-center justify-center ring-1 ring-white/70">
        <AnimatePresence mode="wait">
          {Icon && (
            <motion.div
              key={activeStep}
              initial={{ opacity: 0, scale: 0.4, rotate: -18 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.4, rotate: 18 }}
              transition={{ duration: 0.45, ease: cubicEase }}
              className="text-[var(--blue-500)]"
            >
              <Icon className="w-9 h-9 sm:w-10 sm:h-10" strokeWidth={1.7} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─── 单行步骤 ─── */
function StepRow({
  index,
  step,
  active,
  done,
  pending,
}: {
  index: number;
  step: (typeof STEPS)[number];
  active: boolean;
  done: boolean;
  pending: boolean;
}) {
  const Icon = step.Icon;
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{
        opacity: pending ? 0.45 : 1,
        x: 0,
        y: active ? -1 : 0,
      }}
      transition={{
        duration: 0.5,
        ease: cubicEase,
        delay: 0.35 + index * 0.08,
      }}
      className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl transition-colors"
      style={{
        background: done
          ? "linear-gradient(90deg, rgba(16,185,129,0.07), transparent 80%)"
          : active
            ? "linear-gradient(90deg, var(--blue-50), transparent 80%)"
            : "transparent",
      }}
    >
      {/* 左侧状态点 */}
      <div className="relative shrink-0">
        <motion.div
          animate={{
            backgroundColor: done
              ? "rgb(16,185,129)" // emerald-500
              : active
                ? "var(--blue-500)"
                : "var(--blue-100)",
          }}
          transition={{ duration: 0.4, ease: cubicEase }}
          className="w-9 h-9 rounded-full flex items-center justify-center relative overflow-hidden"
        >
          {/* Running 时的扫光 */}
          {active && !done && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
              className="absolute inset-0"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.55) 22%, transparent 48%)",
              }}
            />
          )}

          <AnimatePresence mode="wait">
            {done ? (
              <motion.svg
                key="check"
                viewBox="0 0 24 24"
                fill="none"
                className="w-5 h-5 relative z-10"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.28, ease: cubicEase }}
              >
                <motion.path
                  d="M5.5 12.5 L10 17 L18.5 7.5"
                  stroke="white"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.42, ease: cubicEase, delay: 0.05 }}
                />
              </motion.svg>
            ) : (
              <motion.div
                key="icon"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.25 }}
                className="relative z-10"
              >
                <Icon
                  className={`w-4 h-4 ${active ? "text-white" : "text-[var(--blue-400)]"}`}
                  strokeWidth={2}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* 完成时的扩散光圈 */}
        {done && (
          <motion.div
            initial={{ opacity: 0.55, scale: 1 }}
            animate={{ opacity: 0, scale: 1.85 }}
            transition={{ duration: 0.9, ease: cubicEase }}
            className="absolute inset-0 rounded-full bg-emerald-500/40 pointer-events-none"
          />
        )}
      </div>

      {/* 中间文案 */}
      <div className="flex-1 min-w-0">
        <motion.div
          animate={{
            color: done
              ? "rgb(6,95,70)" // emerald-900
              : active
                ? "var(--navy-900)"
                : "var(--navy-700)",
          }}
          transition={{ duration: 0.4 }}
          className={`text-sm sm:text-[15px] truncate ${active || done ? "font-semibold" : "font-medium"}`}
        >
          {step.label}
        </motion.div>
        {active && !done && <DotsPulse />}
      </div>

      {/* 右侧状态 */}
      <div className="text-[11px] sm:text-xs tracking-wide shrink-0 min-w-[2.5rem] text-right">
        {done && (
          <motion.span
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.32 }}
            className="text-emerald-600 font-medium"
          >
            完成
          </motion.span>
        )}
        {active && !done && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-[var(--blue-500)] font-medium"
          >
            进行中
          </motion.span>
        )}
        {pending && (
          <span className="text-[var(--navy-700)]/40">待开始</span>
        )}
      </div>
    </motion.div>
  );
}

function DotsPulse() {
  return (
    <div className="flex gap-1 mt-1 h-1.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -1.5, 0] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.18,
            ease: "easeInOut",
          }}
          className="w-1 h-1 rounded-full bg-[var(--blue-400)]"
        />
      ))}
    </div>
  );
}
