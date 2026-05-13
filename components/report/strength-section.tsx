"use client";

import { motion } from "framer-motion";
import { SectionWrapper } from "./section-wrapper";
import { useReportRender } from "./report-context";
import type { Strength } from "@/lib/types";

interface Props {
  data: Strength | null | undefined;
  index: number;
  total: number;
}

const ease: [number, number, number, number] = [0.22, 1, 0.36, 1];

export default function StrengthSection({ data, index, total }: Props) {
  const { exporting } = useReportRender();

  if (!data) {
    return (
      <SectionWrapper
        id="strength"
        title="优势发现"
        index={index}
        total={total}
      >
        <div className="rounded-xl border border-dashed border-[var(--blue-200)] bg-[var(--blue-50)]/40 px-5 py-8 text-center text-[13.5px] text-[var(--report-ink-muted)]">
          ⏳ 优势分析生成中…
        </div>
      </SectionWrapper>
    );
  }

  const safeStrengths = Array.isArray(data.strengths) ? data.strengths : [];
  const safeGrowth = Array.isArray(data.growth) ? data.growth : [];
  const safeAbility = Array.isArray(data.abilityRadar) ? data.abilityRadar : [];

  const CardWrap = exporting ? "div" : motion.div;
  const cardMotion = (i: number) =>
    exporting
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, delay: i * 0.05, ease },
        };

  return (
    <SectionWrapper
      id="strength"
      title="优势发现"
      index={index}
      total={total}
    >
      {/* 能力评估 */}
      {safeAbility.length > 0 && (
        <CardWrap {...cardMotion(0)} className="mb-6">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--report-ink-muted)] mb-3">
            能力评估
          </div>
          <div className="rounded-xl border border-[var(--blue-100)] bg-white p-4 sm:p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {safeAbility.map((a) => {
                const pct = Math.max(0, Math.min(100, Math.round(a.score)));
                return (
                  <div key={a.name}>
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-[13px] text-[var(--navy-800)] font-medium">{a.name}</span>
                      <span className="text-[12px] tabular-nums font-medium text-[var(--report-ink-muted)]">{pct}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--blue-100)] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: "linear-gradient(90deg, var(--blue-400), var(--blue-500))",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardWrap>
      )}

      {/* 优势 */}
      {safeStrengths.length > 0 && (
        <div className="mb-6">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--report-ink-muted)] mb-3">
            核心优势
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {safeStrengths.map((s, i) => (
              <CardWrap
                key={i}
                {...cardMotion(i)}
                className="report-card rounded-xl p-5 break-inside-avoid"
              >
                <h4 className="text-[15px] font-semibold text-[var(--blue-700)] mb-2">
                  {s.title}
                </h4>
                <p className="text-[13.5px] leading-[1.75] text-[var(--navy-800)]">
                  {s.detail}
                </p>
              </CardWrap>
            ))}
          </div>
        </div>
      )}

      {/* 可以更进一步 */}
      {safeGrowth.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--report-ink-muted)] mb-3">
            可以更进一步
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {safeGrowth.map((g, i) => (
              <CardWrap
                key={i}
                {...cardMotion(safeStrengths.length + i)}
                className="rounded-xl border border-[var(--blue-200)] p-5 break-inside-avoid"
                style={{ background: "var(--blue-50)" }}
              >
                <h4 className="text-[15px] font-semibold text-[var(--navy-900)] mb-2">
                  {g.title}
                </h4>
                <p className="text-[13.5px] leading-[1.75] text-[var(--navy-800)]">
                  {g.detail}
                </p>
              </CardWrap>
            ))}
          </div>
        </div>
      )}
    </SectionWrapper>
  );
}
