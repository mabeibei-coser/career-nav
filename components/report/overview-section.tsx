"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { motion } from "framer-motion";
import { SectionWrapper } from "./section-wrapper";
import { useReportRender } from "./report-context";
import type { Overview, ReportMeta } from "@/lib/types";

interface Props {
  data: Overview | null | undefined;
  meta?: ReportMeta;
  index: number;
  total: number;
}

/** 从 "ENFJ · 温和型推动者" 中拆出 code 和 label */
function parsePersonalityType(raw: string): { code: string; label: string } {
  const sep = raw.indexOf("·");
  if (sep < 0) return { code: "", label: raw };
  return {
    code: raw.slice(0, sep).trim(),
    label: raw.slice(sep + 1).trim(),
  };
}

/** 维度色彩映射 — 4 色依次分配 */
const DIM_COLORS = [
  { bar: "var(--blue-500)", bg: "var(--blue-100)" },
  { bar: "oklch(0.62 0.16 165)", bg: "oklch(0.94 0.04 165)" },
  { bar: "oklch(0.62 0.14 55)", bg: "oklch(0.95 0.04 55)" },
  { bar: "oklch(0.55 0.18 280)", bg: "oklch(0.94 0.04 280)" },
];

export function OverviewSection({ data, index, total }: Props) {
  const { exporting } = useReportRender();

  if (!data) {
    return (
      <SectionWrapper id="overview" title="总评" index={index} total={total}>
        <p className="text-[14px] text-[var(--report-ink-muted)]">
          ⏳ 总评模块生成中…
        </p>
      </SectionWrapper>
    );
  }

  const personality = data.personality;
  const traits = Array.isArray(personality?.traits) ? personality.traits : [];
  const fourDim = Array.isArray(data.fourDimRadar) ? data.fourDimRadar : [];
  const { code: mbtiCode, label: mbtiLabel } = parsePersonalityType(
    personality?.type ?? ""
  );

  const fadeIn = exporting
    ? {}
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.3 },
      };

  const radarData = fourDim.map((d) => ({
    subject: d.name,
    value: d.score,
    fullMark: 100,
  }));

  return (
    <SectionWrapper id="overview" title="总评" index={index} total={total}>
      {/* ── Part 1: 四维评估 ── */}
      {fourDim.length > 0 && (
        <motion.div {...fadeIn} className="mb-6">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--report-ink-muted)] mb-3">
            四维评估
          </div>

          {/* 雷达图 + 评分条 */}
          <div className="rounded-xl border border-[var(--blue-100)] bg-white overflow-hidden break-inside-avoid">
            {/* 雷达图 */}
            <div className="flex items-center justify-center px-4 pt-4 sm:pt-5">
              <div className="w-full max-w-[320px] h-[200px] sm:h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="72%">
                    <PolarGrid stroke="var(--blue-200)" />
                    <PolarAngleAxis
                      dataKey="subject"
                      tick={{ fontSize: 11, fill: "var(--navy-700)" }}
                    />
                    <Radar
                      dataKey="value"
                      stroke="var(--primary)"
                      fill="var(--primary)"
                      fillOpacity={0.25}
                      isAnimationActive={!exporting}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 维度评分条 */}
            <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-2 space-y-3">
              {fourDim.map((dim, i) => {
                const color = DIM_COLORS[i % DIM_COLORS.length];
                return (
                  <div key={dim.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12.5px] font-semibold text-[var(--navy-900)]">
                        {dim.name}
                      </span>
                      <span
                        className="text-[12px] font-bold tabular-nums"
                        style={{ color: color.bar }}
                      >
                        {dim.score}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div
                      className="h-2 rounded-full overflow-hidden"
                      style={{ background: color.bg }}
                    >
                      <motion.div
                        className="h-full rounded-full"
                        style={{
                          background: color.bar,
                          ...(exporting ? { width: `${dim.score}%` } : {}),
                        }}
                        {...(exporting
                          ? {}
                          : {
                              initial: { width: 0 },
                              animate: { width: `${dim.score}%` },
                              transition: {
                                duration: 0.8,
                                delay: i * 0.1,
                                ease: [0.22, 1, 0.36, 1],
                              },
                            })}
                      />
                    </div>
                    {dim.conclusion && (
                      <p className="text-[12px] text-[var(--report-ink-muted)] mt-1 leading-relaxed">
                        {dim.conclusion}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Part 2: 职业性格解读 ── */}
      {personality && (
        <motion.div {...fadeIn} className="mb-6">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--report-ink-muted)] mb-3">
            职业性格解读
          </div>
          <div className="rounded-xl border border-[var(--blue-100)] bg-white p-5 break-inside-avoid">
            {/* MBTI code + Chinese label */}
            <div className="flex items-baseline gap-3 mb-3">
              {mbtiCode && (
                <span className="text-[28px] sm:text-[32px] font-black tracking-tight text-[var(--primary)] leading-none">
                  {mbtiCode}
                </span>
              )}
              <span className="text-[15px] sm:text-[16px] font-semibold text-[var(--navy-900)]">
                {mbtiLabel || personality.type}
              </span>
            </div>

            {/* Trait tags */}
            {traits.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {traits.map((t) => (
                  <span key={t} className="report-chip">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Description */}
            {personality.description && (
              <p
                className="text-[14px] text-[var(--navy-800)] leading-[1.75]"
              >
                {personality.description}
              </p>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Part 3: 综合评价 ── */}
      {data.summary && (
        <motion.div {...fadeIn}>
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--report-ink-muted)] mb-3">
            综合评价
          </div>
          <p className="report-takeaway">{data.summary}</p>
        </motion.div>
      )}
    </SectionWrapper>
  );
}
