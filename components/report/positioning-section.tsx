"use client";

import { motion } from "framer-motion";
import { Crown, Star } from "lucide-react";
import { SectionWrapper } from "./section-wrapper";
import { useReportRender } from "./report-context";
import { cn } from "@/lib/utils";
import type { Positioning, PositionRecommendation } from "@/lib/types";

interface Props {
  data: Positioning | null | undefined;
  index?: number;
  total?: number;
}

const ease: [number, number, number, number] = [0.22, 1, 0.36, 1];

function PositionCard({
  rec,
  variant,
  delay,
  exporting,
}: {
  rec: PositionRecommendation;
  variant: "primary" | "secondary";
  delay: number;
  exporting: boolean;
}) {
  const isPrimary = variant === "primary";
  const Icon = isPrimary ? Crown : Star;

  const Wrapper = exporting ? "div" : motion.div;
  const motionProps = exporting
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, delay, ease },
      };

  const safeIndustries = Array.isArray(rec.industries) ? rec.industries : [];

  return (
    <Wrapper
      {...(motionProps as Record<string, unknown>)}
      className={cn(
        "rounded-xl border bg-white p-5 break-inside-avoid",
        isPrimary
          ? "border-[var(--blue-500)] ring-1 ring-[var(--blue-500)]"
          : "border-[var(--blue-100)]"
      )}
    >
      {/* 顶部：角标 + 岗位名 */}
      <div className="flex items-start gap-3 mb-4">
        <span
          className={cn(
            "shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
            isPrimary
              ? "border-[var(--blue-500)] bg-[var(--blue-500)] text-white"
              : "border-[var(--blue-200)] bg-white text-[var(--navy-700)]"
          )}
        >
          <Icon className="size-3" />
          {isPrimary ? "首选" : "次选"}
        </span>
        <h3
          className={cn(
            "flex-1 min-w-0 font-bold tracking-tight leading-tight text-[var(--navy-950)]",
            isPrimary ? "text-[20px] sm:text-[22px]" : "text-[18px] sm:text-[20px]"
          )}
        >
          {rec.position || "—"}
        </h3>
      </div>

      {/* 岗位综述 */}
      {rec.reasoning && (
        <p className="text-[13.5px] leading-[1.75] text-[var(--navy-800)] mb-4">
          {rec.reasoning}
        </p>
      )}

      {/* 行业方向 */}
      {safeIndustries.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--report-ink-muted)] mb-2">
            行业方向
          </div>
          <div className="flex flex-wrap gap-1.5">
            {safeIndustries.map((ind, i) => (
              <span key={`${ind}-${i}`} className="report-chip">
                {ind}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 为什么适合你 */}
      {rec.fitReason && (
        <div className="rounded-xl border border-[var(--blue-200)] bg-gradient-to-br from-[var(--blue-50)] to-white p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <svg className="size-3.5 text-[var(--blue-500)]" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 1l2.35 4.76L16 6.54l-4 3.9.94 5.5L8 13.27l-4.94 2.67.94-5.5-4-3.9 5.65-.78L8 1z" fill="currentColor" />
            </svg>
            <span className="text-[12px] font-bold text-[var(--blue-700)]">
              为什么适合你
            </span>
          </div>
          <p className="text-[13.5px] leading-[1.75] text-[var(--navy-800)]">
            {rec.fitReason}
          </p>
        </div>
      )}
    </Wrapper>
  );
}

export default function PositioningSection({
  data,
  index = 3,
  total = 5,
}: Props) {
  const { exporting } = useReportRender();

  if (!data || !data.primary) {
    return (
      <SectionWrapper
        id="positioning"
        title="职业定位推荐"
        index={index}
        total={total}
      >
        <div className="rounded-xl border border-dashed border-[var(--blue-200)] bg-[var(--blue-50)]/40 px-5 py-8 text-center text-[13.5px] text-[var(--report-ink-muted)]">
          ⏳ 职业定位生成中…
        </div>
      </SectionWrapper>
    );
  }

  const takeaway = data.secondary?.position
    ? `首选：${data.primary.position} · 次选：${data.secondary.position}`
    : `首选方向：${data.primary.position}`;

  return (
    <SectionWrapper
      id="positioning"
      title="职业定位推荐"
      index={index}
      total={total}
      takeaway={takeaway}
    >
      <div className="space-y-5 pt-1">
        <PositionCard
          rec={data.primary}
          variant="primary"
          delay={0}
          exporting={exporting}
        />
        {data.secondary && (
          <PositionCard
            rec={data.secondary}
            variant="secondary"
            delay={0.1}
            exporting={exporting}
          />
        )}
      </div>
    </SectionWrapper>
  );
}
