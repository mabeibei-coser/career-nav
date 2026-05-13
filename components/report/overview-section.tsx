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

/** 四维双极谱配置：低分→左极，高分→右极 */
const BIPOLAR_POLES = [
  { left: "内敛沉稳", right: "主动外向", color: "var(--blue-500)", bg: "var(--blue-100)" },
  { left: "按部就班", right: "灵活应变", color: "oklch(0.55 0.16 165)", bg: "oklch(0.94 0.04 165)" },
  { left: "稳定务实", right: "探索成长", color: "oklch(0.58 0.14 55)", bg: "oklch(0.95 0.04 55)" },
  { left: "专注深耕", right: "多元适应", color: "oklch(0.50 0.18 280)", bg: "oklch(0.94 0.04 280)" },
];

/** 根据分数决定倾向标签：偏左 / 均衡 / 偏右 */
function getTendencyLabel(
  score: number,
  left: string,
  right: string
): { label: string; side: "left" | "center" | "right" } {
  if (score <= 40) return { label: `偏${left.slice(0, 2)}`, side: "left" };
  if (score <= 60) return { label: "较均衡", side: "center" };
  return { label: `偏${right.slice(0, 2)}`, side: "right" };
}

const cubicEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function OverviewSection({ data, index, total }: Props) {
  const { exporting } = useReportRender();

  if (!data) {
    return (
      <SectionWrapper id="overview" title="总评" index={index} total={total}>
        <div className="rounded-xl border border-dashed border-[var(--blue-200)] bg-[var(--blue-50)]/40 px-5 py-8 text-center text-[13.5px] text-[var(--report-ink-muted)]">
          ⏳ 总评模块生成中…
        </div>
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
      {/* ── Part 1: 四维评估卡片 ── */}
      {fourDim.length > 0 && (
        <motion.div {...fadeIn} className="mb-6">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--report-ink-muted)] mb-3">
            四维评估
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 break-inside-avoid">
            {fourDim.map((dim, i) => {
              const poles = BIPOLAR_POLES[i] ?? BIPOLAR_POLES[0];
              const pct = Math.max(2, Math.min(98, dim.score));
              const tendency = getTendencyLabel(dim.score, poles.left, poles.right);

              return (
                <div
                  key={dim.name}
                  className="rounded-xl border border-[var(--blue-100)] bg-white p-4 sm:p-5"
                >
                  {/* 第一行：维度名 + 倾向标签 */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[14px] font-bold text-[var(--navy-900)]">
                      {dim.name}
                    </span>
                    <span
                      className="text-[12px] font-semibold px-2.5 py-0.5 rounded-full"
                      style={{
                        color: poles.color,
                        background: poles.bg,
                      }}
                    >
                      {tendency.label}
                    </span>
                  </div>

                  {/* 第二行：结论（核心信息，最醒目） */}
                  {dim.conclusion && (
                    <p className="text-[13.5px] text-[var(--navy-800)] leading-relaxed mb-3">
                      {dim.conclusion}
                    </p>
                  )}

                  {/* 第三行：光谱条（辅助视觉，缩小为配角） */}
                  <div>
                    <div className="relative h-[6px] rounded-full" style={{ background: poles.bg }}>
                      {/* 渐变 */}
                      <div
                        className="absolute inset-0 rounded-full"
                        style={{
                          background: `linear-gradient(90deg, transparent 0%, ${poles.color} 100%)`,
                          opacity: 0.18,
                        }}
                      />
                      {/* 中线 */}
                      <div className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-px opacity-25" style={{ background: poles.color }} />
                      {/* 标记点 */}
                      {exporting ? (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[13px] h-[13px] rounded-full border-2 border-white"
                          style={{
                            left: `${pct}%`,
                            background: poles.color,
                            boxShadow: `0 1px 4px color-mix(in oklch, ${poles.color} 35%, transparent)`,
                          }}
                        />
                      ) : (
                        <motion.div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[13px] h-[13px] rounded-full border-2 border-white"
                          style={{
                            left: `${pct}%`,
                            background: poles.color,
                            boxShadow: `0 1px 4px color-mix(in oklch, ${poles.color} 35%, transparent)`,
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
                    <div className="flex justify-between mt-1.5">
                      <span className="text-[11px] text-[var(--report-ink-muted)]">
                        {poles.left}
                      </span>
                      <span className="text-[11px] text-[var(--report-ink-muted)]">
                        {poles.right}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
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
