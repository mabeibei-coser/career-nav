"use client";

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

// 分档：≥80 突出 / 60-79 良好 / 40-59 中等 / <40 待提升
function getTier(score: number): { label: string; color: string; bg: string } {
  if (score >= 80) return { label: "突出", color: "var(--blue-700)", bg: "var(--blue-50)" };
  if (score >= 60) return { label: "良好", color: "oklch(0.50 0.14 210)", bg: "oklch(0.97 0.02 210)" };
  if (score >= 40) return { label: "中等", color: "oklch(0.55 0.14 55)", bg: "oklch(0.97 0.04 55)" };
  return { label: "待提升", color: "oklch(0.50 0.16 25)", bg: "oklch(0.97 0.04 25)" };
}

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

  const fadeIn = exporting
    ? {}
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.3 },
      };

  return (
    <SectionWrapper id="overview" title="总评" index={index} total={total}>
      {/* 顶部：性格类型 pill + 标签云 */}
      {personality && (
        <motion.div
          {...fadeIn}
          className="flex flex-wrap items-center gap-2 mb-5"
        >
          {personality.type && (
            <span className="inline-flex items-center rounded-full bg-[var(--primary)] px-3 py-1.5 text-[15px] sm:text-[16px] font-bold text-white tracking-wide min-h-[44px] min-w-[44px] justify-center">
              {personality.type}
            </span>
          )}
          {traits.map((t) => (
            <span key={t} className="report-chip">
              {t}
            </span>
          ))}
        </motion.div>
      )}

      {/* 性格描述 — 蓝色左边框突出样式 */}
      {personality?.description && (
        <motion.div
          {...fadeIn}
          className="mb-5 border-l-[3px] border-[var(--blue-500)] pl-4 py-1"
        >
          <p className="text-[14px] sm:text-[15px] leading-[1.75] text-[var(--navy-800)]">
            {personality.description}
          </p>
        </motion.div>
      )}

      {/* 四维度进度条卡片 */}
      {fourDim.length > 0 && (
        <motion.div {...fadeIn} className="grid gap-3 sm:grid-cols-2 mb-5">
          {fourDim.map((dim) => {
            const score = typeof dim.score === "number" ? Math.max(0, Math.min(100, Math.round(dim.score))) : 0;
            const tier = getTier(score);
            return (
              <div
                key={dim.name}
                className="rounded-xl border border-[var(--blue-100)] bg-white p-4 break-inside-avoid"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] font-semibold text-[var(--navy-900)]">
                    {dim.name}
                  </span>
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{ color: tier.color, background: tier.bg }}
                  >
                    {tier.label}
                  </span>
                </div>
                {/* 进度条 */}
                <div className="h-2 rounded-full bg-[var(--blue-100)] overflow-hidden mb-2">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${score}%`,
                      background: "var(--primary)",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[var(--report-ink-muted)] tabular-nums">
                    {score} / 100
                  </span>
                  {dim.conclusion && (
                    <span className="text-[12px] leading-[1.6] text-[var(--navy-700)] text-right max-w-[60%]">
                      {dim.conclusion}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </motion.div>
      )}

      {/* 综述（蓝条 takeaway 样式） */}
      {data.summary && (
        <motion.p {...fadeIn} className="report-takeaway">
          {data.summary}
        </motion.p>
      )}
    </SectionWrapper>
  );
}
