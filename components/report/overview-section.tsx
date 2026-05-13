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

/** 从 "ENFJ · 温和型推动者" 中拆出 code 和 label */
function parsePersonalityType(raw: string): { code: string; label: string } {
  const sep = raw.indexOf("·");
  if (sep < 0) return { code: "", label: raw };
  return {
    code: raw.slice(0, sep).trim(),
    label: raw.slice(sep + 1).trim(),
  };
}

/** 四维双极谱：低分→左极，高分→右极 */
const BIPOLAR_POLES = [
  { left: "内敛沉稳", right: "主动外向", color: "var(--blue-500)", bg: "var(--blue-100)" },
  { left: "按部就班", right: "灵活应变", color: "oklch(0.55 0.16 165)", bg: "oklch(0.94 0.04 165)" },
  { left: "稳定务实", right: "探索成长", color: "oklch(0.58 0.14 55)", bg: "oklch(0.95 0.04 55)" },
  { left: "专注深耕", right: "多元适应", color: "oklch(0.50 0.18 280)", bg: "oklch(0.94 0.04 280)" },
];

const cubicEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

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

  return (
    <SectionWrapper id="overview" title="总评" index={index} total={total}>
      {/* ── Part 1: 四维双极谱 ── */}
      {fourDim.length > 0 && (
        <motion.div {...fadeIn} className="mb-6">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--report-ink-muted)] mb-3">
            四维评估
          </div>

          <div className="rounded-xl border border-[var(--blue-100)] bg-white overflow-hidden break-inside-avoid">
            <div className="px-5 sm:px-6 py-5 sm:py-6 divide-y divide-[var(--blue-100)]">
              {fourDim.map((dim, i) => {
                const poles = BIPOLAR_POLES[i] ?? BIPOLAR_POLES[0];
                const pct = Math.max(2, Math.min(98, dim.score));

                return (
                  <div
                    key={dim.name}
                    className="py-4 first:pt-0 last:pb-0"
                  >
                    {/* 维度名称 */}
                    <div className="text-[13px] font-semibold text-[var(--navy-900)] mb-3">
                      {dim.name}
                    </div>

                    {/* 轨道 + 标记 */}
                    <div className="relative h-[7px] rounded-full mx-0.5" style={{ background: poles.bg }}>
                      {/* 渐变填充 */}
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{
                          background: `linear-gradient(90deg, transparent 0%, ${poles.color} 100%)`,
                          opacity: 0.2,
                        }}
                      />
                      {/* 中线 */}
                      <div className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-px opacity-30" style={{ background: poles.color }} />

                      {/* 标记点 */}
                      {exporting ? (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[15px] h-[15px] rounded-full border-[2.5px] border-white"
                          style={{
                            left: `${pct}%`,
                            background: poles.color,
                            boxShadow: `0 1px 6px color-mix(in oklch, ${poles.color} 40%, transparent)`,
                          }}
                        />
                      ) : (
                        <motion.div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[15px] h-[15px] rounded-full border-[2.5px] border-white"
                          style={{
                            left: `${pct}%`,
                            background: poles.color,
                            boxShadow: `0 1px 6px color-mix(in oklch, ${poles.color} 40%, transparent)`,
                          }}
                          initial={{ opacity: 0, scale: 0 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{
                            duration: 0.5,
                            delay: 0.3 + i * 0.12,
                            ease: cubicEase,
                          }}
                        />
                      )}
                    </div>

                    {/* 两极标签 */}
                    <div className="flex justify-between mt-2 mx-0.5">
                      <span className="text-[11px] text-[var(--report-ink-muted)]">
                        {poles.left}
                      </span>
                      <span className="text-[11px] text-[var(--report-ink-muted)]">
                        {poles.right}
                      </span>
                    </div>

                    {/* 结论 */}
                    {dim.conclusion && (
                      <p className="text-[12.5px] text-[var(--navy-700)] mt-1.5 leading-relaxed">
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
            {/* Code + Chinese label */}
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
              <p className="text-[14px] text-[var(--navy-800)] leading-[1.75]">
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
