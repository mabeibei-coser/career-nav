"use client";

import { useRef, useEffect, useState } from "react";
import { motion, useInView, useMotionValue, useSpring } from "framer-motion";
import Link from "next/link";
import {
  ClipboardList,
  MessageCircle,
  FileBarChart,
  ArrowRight,
  Sparkles,
  Shield,
  Zap,
  Brain,
  BarChart3,
  Target,
  TrendingUp,
  Award,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/* ─── Animation helpers ─── */
const cubicEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.7, ease: cubicEase },
  }),
};

const scaleReveal = {
  hidden: { opacity: 0, scale: 0.88, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { delay: 0.4 + i * 0.12, duration: 0.6, ease: cubicEase },
  }),
};

/* ─── Animated counter component ─── */
function AnimatedCounter({
  target,
  suffix = "",
  prefix = "",
  duration = 2,
}: {
  target: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, { duration: duration * 1000, bounce: 0 });

  useEffect(() => {
    if (isInView) motionVal.set(target);
  }, [isInView, motionVal, target]);

  useEffect(() => {
    const unsubscribe = spring.on("change", (v) => {
      if (ref.current) {
        ref.current.textContent =
          prefix + Math.round(v).toLocaleString() + suffix;
      }
    });
    return unsubscribe;
  }, [spring, suffix, prefix]);

  return <span ref={ref}>{prefix}0{suffix}</span>;
}

/* ─── Spotlight card with cursor tracking ─── */
function SpotlightCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    cardRef.current?.style.setProperty("--spotlight-x", `${x}%`);
    cardRef.current?.style.setProperty("--spotlight-y", `${y}%`);
  };
  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      className={`spotlight-card ${className}`}
    >
      {children}
    </div>
  );
}

/* ─── Data ─── */
const steps = [
  {
    icon: ClipboardList,
    step: "01",
    title: "填写求职意向",
    desc: "填写意向岗位、学历、公司、城市 4 项；可选上传 PDF/Word 简历作为分析加成",
    accent: "from-blue-500 to-cyan-400",
    delay: 0,
  },
  {
    icon: MessageCircle,
    step: "02",
    title: "6 题 AI 快测",
    desc: "AI 语音朗读题目，覆盖 MBTI 四维度 + 风险偏好 + 价值取向，1-2 分钟完成",
    accent: "from-indigo-500 to-blue-400",
    delay: 1,
  },
  {
    icon: FileBarChart,
    step: "03",
    title: "生成 7 章节定位报告",
    desc: "总览 · 岗位薪资 · 岗位信息 · 简历诊断 · 谈薪要点 · 发展建议 · 职场环境透视",
    accent: "from-violet-500 to-indigo-400",
    delay: 2,
  },
];

const stats = [
  { value: 10000, suffix: "+", label: "已服务咨询", icon: Target },
  { value: 27, suffix: "个", label: "覆盖行业", icon: Building2 },
  { value: 95, suffix: "%+", label: "报告满意度", icon: TrendingUp },
  { value: 3, suffix: "min", label: "平均生成时间", icon: Zap },
];

const features = [
  {
    icon: Brain,
    title: "深度 AI 分析引擎",
    desc: "基于大语言模型的多维度职业画像分析，覆盖岗位职责、能力评估、发展路径",
  },
  {
    icon: BarChart3,
    title: "可视化数据报告",
    desc: "雷达图、环形图、时间线等多种图表，让复杂数据一目了然",
  },
  {
    icon: Shield,
    title: "专业权威可信赖",
    desc: "结构化报告输出，每项分析有据可依，支持职业咨询辅助决策",
  },
  {
    icon: Sparkles,
    title: "个性化智能建议",
    desc: "基于访谈内容生成针对性发展建议，而非千人一面的模板报告",
  },
];

/* ─── Hero SVG visualization ─── */
function HeroVisualization() {
  const radarPoints = [
    { label: "领导力", x: 200, y: 60, score: 0.85 },
    { label: "专业", x: 330, y: 140, score: 0.92 },
    { label: "沟通", x: 300, y: 290, score: 0.78 },
    { label: "创新", x: 100, y: 290, score: 0.7 },
    { label: "执行", x: 70, y: 140, score: 0.88 },
  ];
  const cx = 200,
    cy = 185,
    maxR = 100;
  const getXY = (i: number, r: number) => {
    const angle = (Math.PI * 2 * i) / radarPoints.length - Math.PI / 2;
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  };
  const polygonPoints = radarPoints
    .map((p, i) => {
      const pt = getXY(i, maxR * p.score);
      return `${pt.x},${pt.y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 400 360"
      className="w-full max-w-md mx-auto"
      style={{ filter: "drop-shadow(0 0 40px oklch(0.55 0.18 250 / 0.15))" }}
    >
      {/* Radar grid rings */}
      {[0.33, 0.66, 1].map((r) => (
        <polygon
          key={r}
          points={Array.from({ length: 5 }, (_, i) => {
            const pt = getXY(i, maxR * r);
            return `${pt.x},${pt.y}`;
          }).join(" ")}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />
      ))}
      {/* Axis lines */}
      {radarPoints.map((_, i) => {
        const pt = getXY(i, maxR);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={pt.x}
            y2={pt.y}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
        );
      })}
      {/* Radar sweep */}
      <defs>
        <linearGradient id="sweep-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="100%" stopColor="oklch(0.65 0.16 245 / 0.3)" />
        </linearGradient>
      </defs>
      <g className="radar-sweep" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <line
          x1={cx}
          y1={cy}
          x2={cx + maxR}
          y2={cy}
          stroke="url(#sweep-grad)"
          strokeWidth="2"
        />
        <path
          d={`M ${cx} ${cy} L ${cx + maxR} ${cy} A ${maxR} ${maxR} 0 0 1 ${cx + maxR * Math.cos(Math.PI / 6)} ${cy + maxR * Math.sin(Math.PI / 6)} Z`}
          fill="oklch(0.65 0.16 245 / 0.04)"
        />
      </g>
      {/* Data polygon */}
      <motion.polygon
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8, duration: 1.2, ease: cubicEase }}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
        points={polygonPoints}
        fill="oklch(0.55 0.18 250 / 0.15)"
        stroke="oklch(0.65 0.16 245 / 0.7)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Data points with glow */}
      {radarPoints.map((p, i) => {
        const pt = getXY(i, maxR * p.score);
        return (
          <g key={i}>
            <motion.circle
              initial={{ opacity: 0, r: 0 }}
              animate={{ opacity: 0.3, r: 8 }}
              transition={{ delay: 1.2 + i * 0.1, duration: 0.5 }}
              cx={pt.x}
              cy={pt.y}
              fill="oklch(0.65 0.16 245)"
              className="pulse-dot"
              style={{ animationDelay: `${i * 0.6}s` }}
            />
            <motion.circle
              initial={{ opacity: 0, r: 0 }}
              animate={{ opacity: 1, r: 4 }}
              transition={{ delay: 1.2 + i * 0.1, duration: 0.4 }}
              cx={pt.x}
              cy={pt.y}
              fill="white"
              stroke="oklch(0.65 0.16 245)"
              strokeWidth="2"
            />
            <motion.text
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.7 }}
              transition={{ delay: 1.5 + i * 0.1 }}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              fill="white"
              fontSize="11"
              fontWeight="500"
            >
              {p.label}
            </motion.text>
          </g>
        );
      })}
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="3" fill="oklch(0.65 0.16 245 / 0.6)" />
    </svg>
  );
}

/* ─── Constellation background particles ─── */
function ConstellationBG() {
  const particles = [
    { x: 10, y: 20, size: 2, delay: 0 },
    { x: 85, y: 15, size: 1.5, delay: 1 },
    { x: 25, y: 70, size: 1, delay: 2 },
    { x: 70, y: 65, size: 2, delay: 0.5 },
    { x: 50, y: 35, size: 1.5, delay: 1.5 },
    { x: 90, y: 80, size: 1, delay: 3 },
    { x: 15, y: 45, size: 1, delay: 2.5 },
    { x: 60, y: 85, size: 1.5, delay: 1 },
    { x: 40, y: 10, size: 1, delay: 0.8 },
    { x: 78, y: 40, size: 2, delay: 1.2 },
  ];
  const lines = [
    [0, 4],
    [4, 1],
    [4, 3],
    [2, 6],
    [3, 7],
    [1, 9],
    [8, 0],
  ];
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg className="absolute inset-0 w-full h-full">
        {lines.map(([a, b], i) => (
          <line
            key={i}
            x1={`${particles[a].x}%`}
            y1={`${particles[a].y}%`}
            x2={`${particles[b].x}%`}
            y2={`${particles[b].y}%`}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
            className="constellation-line"
            style={{ animationDelay: `${i * 0.7}s` }}
          />
        ))}
      </svg>
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white pulse-dot"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size * 2,
            height: p.size * 2,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════ */
export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen overflow-x-hidden bg-[var(--background)]">
      {/* ═══ HERO ═══ */}
      <section className="relative min-h-[90vh] flex items-center overflow-hidden">
        {/* Layered background */}
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--navy-950)] via-[var(--navy-900)] to-[var(--navy-800)]" />
        <div className="absolute inset-0 aurora-bg" />
        <div className="absolute inset-0 hero-grid" />
        <div className="absolute inset-0 noise-overlay" />
        <ConstellationBG />

        {/* Large decorative orbs */}
        <div className="absolute top-[-20%] right-[-10%] w-[700px] h-[700px] rounded-full bg-[var(--blue-500)] opacity-[0.06] blur-[150px]" />
        <div className="absolute bottom-[-30%] left-[-15%] w-[600px] h-[600px] rounded-full bg-[var(--blue-300)] opacity-[0.04] blur-[130px]" />
        <div className="absolute top-[40%] left-[50%] w-[400px] h-[400px] rounded-full bg-violet-500 opacity-[0.03] blur-[120px]" />

        {/* Subtle vertical accent lines */}
        {[20, 40, 60, 80].map((pos) => (
          <div
            key={pos}
            className="absolute top-0 w-px h-full bg-gradient-to-b from-transparent via-white/[0.03] to-transparent"
            style={{ left: `${pos}%` }}
          />
        ))}

        <div className="relative z-10 w-full max-w-6xl mx-auto px-6 py-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left: Text content */}
            <div className="text-center lg:text-left">
              <motion.div variants={fadeUp} initial="hidden" animate="visible" custom={0}>
                <Badge
                  variant="outline"
                  className="mb-6 border-white/15 bg-white/[0.05] text-white/70 backdrop-blur-md px-4 py-1.5 text-xs tracking-[0.15em] font-light"
                >
                  <span className="size-1.5 rounded-full bg-emerald-400 mr-2 inline-block animate-pulse" />
                  智能职业定位分析系统
                </Badge>
              </motion.div>

              <motion.h1
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                custom={1}
                className="text-5xl sm:text-6xl lg:text-[4.5rem] font-extrabold tracking-tight leading-[1.05] text-gradient-hero"
              >
                谨世 ATA
                <br />
                职业导航报告
              </motion.h1>

              <motion.div
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                custom={2}
                className="mt-6 flex items-center gap-3 justify-center lg:justify-start"
              >
                <div className="h-px w-16 bg-gradient-to-r from-[var(--blue-400)] to-transparent" />
                <span className="text-xs text-blue-300/50 tracking-[0.2em] font-light uppercase">
                  Career Positioning
                </span>
              </motion.div>

              <motion.p
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                custom={3}
                className="mt-6 text-lg text-blue-100/60 max-w-lg leading-relaxed font-light mx-auto lg:mx-0"
              >
                面向应届大学生的职业定位工具：填写求职意向 + 上传简历（选填），1-2 分钟完成 AI 语音快测，获得含薪资、谈薪、发展建议的 7 章节报告
              </motion.p>

              <motion.div
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                custom={4}
                className="mt-10 flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start"
              >
                <Link href="/form" className="w-full sm:w-auto">
                  <Button
                    size="lg"
                    className="animate-cta-pulse w-full sm:w-auto h-16 px-12 text-lg font-bold bg-[var(--blue-500)] text-white hover:bg-[var(--blue-600)] border-0 rounded-2xl ring-2 ring-white/20 hover:ring-white/40 shadow-2xl shadow-blue-500/40 transition-all duration-300 cursor-pointer"
                  >
                    开始职业分析
                    <ArrowRight className="ml-2 size-6 transition-transform group-hover/button:translate-x-1" />
                  </Button>
                </Link>
                <span className="text-xs text-blue-200/30 font-light">
                  无需注册 &middot; 即刻体验
                </span>
              </motion.div>

              {/* Inline trust indicators */}
              <motion.div
                variants={fadeUp}
                initial="hidden"
                animate="visible"
                custom={5}
                className="mt-10 flex items-center gap-5 justify-center lg:justify-start"
              >
                {["AI 实时分析", "结构化报告", "数据可视化"].map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1.5 text-xs text-blue-200/40 font-light"
                  >
                    <span className="size-1 rounded-full bg-emerald-400/50" />
                    {t}
                  </span>
                ))}
              </motion.div>
            </div>

            {/* Right: Radar visualization */}
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5, duration: 0.8, ease: cubicEase }}
              className="hidden lg:block"
            >
              <HeroVisualization />
            </motion.div>
          </div>
        </div>

        {/* Bottom gradient fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[var(--background)] to-transparent" />
      </section>

      {/* ═══ PROCESS STEPS ═══ */}
      <section className="relative -mt-16 z-20 max-w-5xl mx-auto w-full px-6">
        {/* Connecting line behind cards */}
        <div className="hidden md:block absolute top-1/2 left-[15%] right-[15%] h-px">
          <svg className="w-full h-4 -mt-2" preserveAspectRatio="none">
            <line
              x1="0"
              y1="8"
              x2="100%"
              y2="8"
              stroke="var(--blue-200)"
              strokeWidth="2"
              className="dash-animated"
              strokeOpacity="0.4"
            />
          </svg>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {steps.map((step, i) => (
            <motion.div
              key={step.step}
              variants={scaleReveal}
              initial="hidden"
              animate="visible"
              custom={i}
            >
              <SpotlightCard className="h-full">
                <div className="glass-card gradient-border-card rounded-2xl p-7 h-full relative transition-all duration-500">
                  {/* Step number */}
                  <div className="flex items-center justify-between mb-5">
                    <div
                      className={`flex items-center justify-center size-12 rounded-2xl bg-gradient-to-br ${step.accent} text-white shadow-lg shadow-blue-500/20`}
                    >
                      <step.icon
                        className="size-5 animate-float"
                        style={{ animationDelay: `${step.delay}s` }}
                        strokeWidth={1.8}
                      />
                    </div>
                    <span className="text-3xl font-black text-[var(--blue-100)] font-mono tracking-tight">
                      {step.step}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-[var(--foreground)] mb-2 tracking-tight">
                    {step.title}
                  </h3>
                  <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              </SpotlightCard>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ═══ STATS BAR ═══ */}
      <section className="max-w-5xl mx-auto w-full px-6 py-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.08, duration: 0.5 }}
              className="text-center py-6"
            >
              <div className="inline-flex items-center justify-center size-10 rounded-xl bg-[var(--blue-50)] text-[var(--blue-500)] mb-3">
                <stat.icon className="size-5" strokeWidth={1.8} />
              </div>
              <div className="text-3xl font-extrabold text-[var(--foreground)] tracking-tight stat-underline inline-block">
                <AnimatedCounter
                  target={stat.value}
                  suffix={stat.suffix}
                  duration={1.8}
                />
              </div>
              <div className="mt-2 text-xs text-[var(--muted-foreground)] tracking-wide">
                {stat.label}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section className="relative py-24 overflow-hidden">
        {/* Subtle background accent */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--blue-50)] to-transparent opacity-50" />

        <div className="relative max-w-5xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <Badge variant="secondary" className="mb-4 text-xs tracking-wider">
              核心能力
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] tracking-tight">
              为什么选择谨世 ATA 职业导航报告
            </h2>
            <p className="mt-4 text-base text-[var(--muted-foreground)] max-w-xl mx-auto">
              将职业咨询从经验判断升级为数据驱动的专业分析
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {features.map((feat, i) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
              >
                <SpotlightCard>
                  <div className="gradient-border-card rounded-2xl p-6 h-full flex gap-5 items-start transition-all duration-500 hover:shadow-lg hover:shadow-blue-100/50">
                    <div className="flex-shrink-0 flex items-center justify-center size-12 rounded-2xl bg-gradient-to-br from-[var(--blue-500)] to-[var(--blue-400)] text-white shadow-md shadow-blue-500/15">
                      <feat.icon className="size-5" strokeWidth={1.8} />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-[var(--foreground)] mb-1.5">
                        {feat.title}
                      </h3>
                      <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
                        {feat.desc}
                      </p>
                    </div>
                  </div>
                </SpotlightCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ TRUST / SOCIAL PROOF ═══ */}
      <section className="max-w-5xl mx-auto w-full px-6 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative rounded-3xl overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--navy-950)] via-[var(--navy-900)] to-[var(--navy-800)]" />
          <div className="absolute inset-0 noise-overlay" />
          <div className="absolute inset-0 hero-grid opacity-50" />

          <div className="relative z-10 px-8 sm:px-12 py-14 text-center">
            <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
              {[
                { icon: Shield, text: "数据安全保障" },
                { icon: Award, text: "AI 技术驱动" },
                { icon: Building2, text: "政务级服务标准" },
              ].map((badge) => (
                <div
                  key={badge.text}
                  className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-sm"
                >
                  <badge.icon className="size-3.5 text-blue-300/70" />
                  <span className="text-xs text-blue-100/60 font-light tracking-wide">
                    {badge.text}
                  </span>
                </div>
              ))}
            </div>

            <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-4">
              让应届求职准备不再迷茫
            </h3>
            <p className="text-sm text-blue-200/50 max-w-lg mx-auto mb-8 leading-relaxed">
              面向应届大学生的职业导航工具：AI 结合你的意向岗位、性格测评和简历，生成一份可执行、有数据的职业导航报告
            </p>

            <Link href="/form">
              <Button
                size="lg"
                className="btn-glow h-12 px-8 text-sm font-medium bg-white text-[var(--navy-900)] hover:bg-blue-50 border-0 rounded-xl cursor-pointer"
              >
                立即开始分析
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="relative">
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--blue-200)] to-transparent" />
        <div className="max-w-5xl mx-auto w-full px-6 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-lg bg-gradient-to-br from-[var(--blue-500)] to-[var(--navy-700)] flex items-center justify-center">
                <FileBarChart className="size-4 text-white" />
              </div>
              <span className="text-sm font-semibold text-[var(--foreground)]">
                谨世 ATA 职业导航报告
              </span>
            </div>
            <span className="text-xs text-[var(--muted-foreground)]">
              &copy; {new Date().getFullYear()} 智能职业定位分析系统
              &middot; 专业咨询辅助工具
            </span>
          </div>
        </div>
      </footer>
      <MobileStickyCTA />
    </div>
  );
}

function MobileStickyCTA() {
  const [hidden, setHidden] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 800);
    const footer = document.querySelector("footer");
    if (!footer) return () => clearTimeout(t);
    const io = new IntersectionObserver(
      ([e]) => setHidden(e.isIntersecting),
      { threshold: 0.1 }
    );
    io.observe(footer);
    return () => {
      clearTimeout(t);
      io.disconnect();
    };
  }, []);
  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: mounted && !hidden ? 0 : 100, opacity: mounted && !hidden ? 1 : 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="fixed bottom-0 left-0 right-0 z-50 lg:hidden px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 bg-gradient-to-t from-white via-white/95 to-transparent backdrop-blur-md"
    >
      <Link href="/form" className="block">
        <Button className="w-full h-14 text-base font-bold bg-[var(--blue-500)] text-white hover:bg-[var(--blue-600)] rounded-2xl shadow-2xl shadow-blue-500/40">
          开始职业分析 <ArrowRight className="ml-2 size-5" />
        </Button>
      </Link>
    </motion.div>
  );
}
