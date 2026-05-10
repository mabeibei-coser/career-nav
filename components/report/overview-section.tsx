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
          className="mb-5"
        >
          <p className="report-takeaway">
            {personality.description}
          </p>
        </motion.div>
      )}

      {/* 四维度文字说明 */}
      {fourDim.length > 0 && (
        <motion.div {...fadeIn} className="space-y-2.5 mb-5">
          {fourDim.map((dim) => (
            <div
              key={dim.name}
              className="flex items-baseline gap-2 rounded-xl border border-[var(--blue-100)] bg-white px-4 py-3 break-inside-avoid"
            >
              <span className="shrink-0 text-[12.5px] font-semibold text-[var(--navy-900)] min-w-[56px]">
                {dim.name}
              </span>
              <span className="text-[13px] leading-[1.65] text-[var(--navy-700)]">
                {dim.conclusion ?? "—"}
              </span>
            </div>
          ))}
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
