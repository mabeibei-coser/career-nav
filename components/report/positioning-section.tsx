"use client";

import * as React from "react";
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

/** 能力分档：参考 career-report 的 优/良/中/待强化 */
const BAR_GRADIENT = "linear-gradient(90deg, var(--blue-400), var(--blue-500))";
const BAR_GRADIENT_WEAK = "linear-gradient(90deg, oklch(0.82 0.05 240), var(--blue-300))";

function getScoreStyle(score: number): {
  gradient: string;
  tierLabel: string;
  tierColor: string;
} {
  if (score >= 85) return { gradient: BAR_GRADIENT, tierLabel: "优", tierColor: "var(--blue-500)" };
  if (score >= 70) return { gradient: BAR_GRADIENT, tierLabel: "良", tierColor: "var(--blue-500)" };
  if (score >= 60) return { gradient: BAR_GRADIENT, tierLabel: "中", tierColor: "var(--blue-400)" };
  return { gradient: BAR_GRADIENT_WEAK, tierLabel: "待强化", tierColor: "oklch(0.55 0.06 240)" };
}

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
  const coreResponsibilities = Array.isArray(rec.coreResponsibilities) ? rec.coreResponsibilities : [];
  const coreCompetencies = Array.isArray(rec.coreCompetencies) ? rec.coreCompetencies : [];

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
      {/* 顶部：角标 + 岗位名 + 匹配度 */}
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

      {/* 推荐理由 */}
      {rec.reasoning && (
        <p className="text-[13.5px] leading-[1.7] text-[var(--navy-800)] mb-5">
          {rec.reasoning}
        </p>
      )}

      {/* 核心职责 + 核心能力 */}
      <div className="grid gap-5 md:grid-cols-2">
        {/* 核心职责 */}
        {coreResponsibilities.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--report-ink-muted)] mb-2">
              核心职责
            </div>
            <ul className="space-y-1.5">
              {coreResponsibilities.map((resp, i) => (
                <li key={i} className="flex items-start gap-2 text-[13.5px] text-[var(--navy-800)] leading-relaxed">
                  <span className="mt-1.5 size-1.5 rounded-full bg-[var(--blue-500)] shrink-0" />
                  {resp}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 核心能力 */}
        {coreCompetencies.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--report-ink-muted)] mb-2">
              核心能力要求
            </div>
            <div className="space-y-2.5">
              {coreCompetencies.map((comp, i) => {
                const compScore = typeof comp.score === "number" ? Math.max(0, Math.min(100, Math.round(comp.score))) : 0;
                const style = getScoreStyle(compScore);
                return (
                  <div key={i}>
                    <div className="flex items-baseline justify-between mb-1 text-[12px]">
                      <span className="text-[var(--navy-800)] font-medium">{comp.name}</span>
                      <span
                        className="px-1.5 py-[1px] rounded text-[10px] font-medium"
                        style={{
                          color: style.tierColor,
                          background: `color-mix(in oklch, ${style.tierColor} 12%, transparent)`,
                        }}
                      >
                        {style.tierLabel}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--blue-100)] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${compScore}%`, background: style.gradient }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 行业方向 */}
      {safeIndustries.length > 0 && (
        <div className="mt-5">
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
        <div className="mt-5 rounded-lg border-l-4 border-[var(--blue-500)] bg-[var(--blue-50)]/60 px-4 py-3">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-[var(--blue-700)] mb-1.5">
            为什么适合你
          </div>
          <p className="text-[13.5px] leading-[1.7] text-[var(--navy-800)]">
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
