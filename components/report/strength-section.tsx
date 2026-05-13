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
        <div className="flex items-center justify-center py-10 text-[14px] text-[var(--report-ink-muted)]">
          ⏳ 优势分析生成中…
        </div>
      </SectionWrapper>
    );
  }

  const safeStrengths = Array.isArray(data.strengths) ? data.strengths : [];
  const safeGrowth = Array.isArray(data.growth) ? data.growth : [];

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
                <p
                  className="text-[14px] text-[var(--navy-800)]"
                  style={{ lineHeight: 1.65 }}
                >
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
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--blue-700)] mb-3">
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
                <p
                  className="text-[14px] text-[var(--navy-800)]"
                  style={{ lineHeight: 1.65 }}
                >
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
