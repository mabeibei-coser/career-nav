"use client";

import { motion } from "framer-motion";
import { Clock } from "lucide-react";
import { SectionWrapper } from "./section-wrapper";
import { useReportRender } from "./report-context";
import type { Advice } from "@/lib/types";

interface Props {
  data: Advice | null | undefined;
  index: number;
  total: number;
}

const ease: [number, number, number, number] = [0.22, 1, 0.36, 1];

const STEP_ACCENT = {
  num: "var(--blue-600)",
  border: "var(--blue-200)",
  bg: "var(--blue-50)",
};

export default function AdviceSection({ data, index, total }: Props) {
  const { exporting } = useReportRender();

  if (!data) {
    return (
      <SectionWrapper
        id="advice"
        title="下一步行动计划"
        index={index}
        total={total}
      >
        <p className="text-[14px] text-[var(--report-ink-muted)]">
          ⏳ 行动计划生成中…
        </p>
      </SectionWrapper>
    );
  }

  const topThree = Array.isArray(data.topThree) ? data.topThree.slice(0, 3) : [];

  return (
    <SectionWrapper
      id="advice"
      title="下一步行动计划"
      index={index}
      total={total}
    >
      {topThree.length > 0 && (
        <div className="space-y-4">
          {topThree.map((item, i) => {
            const accent = STEP_ACCENT;

            const Wrapper = exporting ? "div" : motion.div;
            const motionProps = exporting
              ? {}
              : {
                  initial: { opacity: 0, y: 10 },
                  animate: { opacity: 1, y: 0 },
                  transition: { duration: 0.35, delay: i * 0.08, ease },
                };

            return (
              <Wrapper
                key={i}
                {...motionProps}
                className="rounded-xl border bg-white overflow-hidden break-inside-avoid"
                style={{ borderColor: accent.border, borderLeftWidth: 4 }}
              >
                <div className="p-5">
                  {/* 顶行：序号 + 标题 + 时间 */}
                  <div className="flex items-start gap-3 mb-3">
                    <span
                      className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold text-white tabular-nums"
                      style={{ background: accent.num }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[15px] font-semibold text-[var(--navy-950)] leading-snug">
                        {item.title}
                      </h4>
                    </div>
                    {item.deadline && (
                      <span
                        className="shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                        style={{ background: accent.bg, color: accent.num }}
                      >
                        <Clock className="size-3" />
                        {item.deadline}
                      </span>
                    )}
                  </div>

                  {/* 详情 */}
                  <p className="text-[14px] leading-[1.75] text-[var(--navy-800)] pl-10">
                    {item.detail}
                  </p>
                </div>
              </Wrapper>
            );
          })}
        </div>
      )}

    </SectionWrapper>
  );
}
