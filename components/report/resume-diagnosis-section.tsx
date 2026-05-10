"use client";

import { motion } from "framer-motion";
import { FileSearch, Inbox, Loader2 } from "lucide-react";
import { SectionWrapper } from "./section-wrapper";
import { useReportRender } from "./report-context";
import type { ResumeDiagnosis } from "@/lib/types";

interface Props {
  data: ResumeDiagnosis | null | undefined;
  hasResume?: boolean;
}

const SECTION_INDEX = 4;
const SECTION_TOTAL = 5;

// 优先级 → tone（low 走 .report-chip 默认中性蓝灰，不设 data-tone）
const PRIORITY_TONE: Record<"high" | "medium" | "low", "danger" | "warning" | undefined> = {
  high: "danger",
  medium: "warning",
  low: undefined,
};

// 措辞按 prompt 红线：支持性语气，不审判
const PRIORITY_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "建议优先补充",
  medium: "建议加强",
  low: "可以补充",
};

// 分数档位（仅用于圆环主色）
function getScoreColor(score: number) {
  if (score >= 85) return "var(--blue-700)";
  if (score >= 70) return "var(--blue-600)";
  if (score >= 55) return "oklch(0.55 0.14 55)";
  return "oklch(0.5 0.16 25)";
}

const fadeIn = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

export default function ResumeDiagnosisSection({ data, hasResume }: Props) {
  const { exporting } = useReportRender();

  // 兜底状态：未上传简历
  if (data == null && hasResume === false) {
    return (
      <SectionWrapper
        id="resume-diagnosis"
        title="简历快诊"
        index={SECTION_INDEX}
        total={SECTION_TOTAL}
      >
        <div
          data-pdf-section="resume-diagnosis"
          className="rounded-xl border border-dashed border-[var(--blue-200)] bg-[var(--blue-50)]/40 p-5 sm:p-6 flex items-start gap-3"
        >
          <div className="rounded-full bg-white p-2 border border-[var(--blue-200)] shrink-0">
            <Inbox className="size-5 text-[var(--blue-500)]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-[var(--navy-900)] mb-1">
              本模块已跳过
            </h3>
            <p className="text-[13.5px] leading-[1.7] text-[var(--report-ink-soft)]">
              你未上传简历，简历快诊不参与本次评估。如需此模块的反馈，可在表单页补传简历后重新生成报告。
            </p>
          </div>
        </div>
      </SectionWrapper>
    );
  }

  // 兜底状态：已上传但还在生成
  if (data == null) {
    return (
      <SectionWrapper
        id="resume-diagnosis"
        title="简历快诊"
        index={SECTION_INDEX}
        total={SECTION_TOTAL}
      >
        <div
          data-pdf-section="resume-diagnosis"
          className="rounded-xl border border-[var(--blue-100)] bg-white p-5 sm:p-6 flex items-center gap-3"
        >
          <Loader2 className="size-5 text-[var(--blue-500)] animate-spin shrink-0" />
          <p className="text-[13.5px] text-[var(--report-ink-soft)]">
            简历快诊生成中…
          </p>
        </div>
      </SectionWrapper>
    );
  }

  // 正常态
  const rawScore =
    typeof data.overallScore === "number" && isFinite(data.overallScore)
      ? data.overallScore
      : 0;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const scoreColor = getScoreColor(score);

  const issues = Array.isArray(data.issues) ? data.issues : [];
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];

  // SVG 圆环参数
  const ringSize = 92;
  const stroke = 8;
  const radius = (ringSize - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);

  const Container = exporting ? "div" : motion.div;
  const Item = exporting ? "div" : motion.div;
  const containerProps = exporting
    ? {}
    : { initial: "hidden", animate: "show", variants: stagger };
  const itemProps = exporting ? {} : { variants: fadeIn };

  return (
    <SectionWrapper
      id="resume-diagnosis"
      title="简历快诊"
      index={SECTION_INDEX}
      total={SECTION_TOTAL}
      meta={
        <span>
          {issues.length} 条可补充 · {suggestions.length} 条建议
        </span>
      }
    >
      <div data-pdf-section="resume-diagnosis">
        {/* 顶部：分数圆环 */}
        <div className="rounded-xl border border-[var(--blue-100)] bg-gradient-to-br from-[var(--blue-50)]/60 to-white p-4 sm:p-5 mb-5 break-inside-avoid">
          <div className="flex items-center gap-4">
            {/* 圆环 */}
            <div
              className="relative shrink-0"
              style={{ width: ringSize, height: ringSize }}
              aria-label={`简历完成度 ${score} 分`}
            >
              <svg
                width={ringSize}
                height={ringSize}
                viewBox={`0 0 ${ringSize} ${ringSize}`}
                className="-rotate-90"
              >
                <circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={radius}
                  fill="none"
                  stroke="var(--blue-100)"
                  strokeWidth={stroke}
                />
                <circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={radius}
                  fill="none"
                  stroke={scoreColor}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  style={{ transition: "stroke-dashoffset 0.6s ease" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className="report-kpi"
                  style={{ display: "flex", justifyContent: "center" }}
                >
                  <span
                    className="n"
                    style={{
                      color: scoreColor,
                      fontSize: "clamp(20px, 6vw, 28px)",
                    }}
                  >
                    {score}
                  </span>
                  <span className="u">/100</span>
                </span>
              </div>
            </div>

            {/* 文案 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <FileSearch className="size-4 text-[var(--blue-500)]" />
                <span className="text-xs uppercase tracking-wider text-[var(--report-ink-muted)]">
                  Resume Score
                </span>
              </div>
              <h3 className="text-[15px] sm:text-base font-semibold text-[var(--navy-900)] mb-0.5">
                简历整体完成度
              </h3>
              <p className="text-[12.5px] font-medium mb-1" style={{ color: getScoreColor(score) }}>
                {score >= 85 ? "简历基础扎实" : score >= 70 ? "简历有一定基础" : score >= 55 ? "简历需要补充" : "简历需要较多完善"}
              </p>
              <p className="text-[13px] leading-[1.65] text-[var(--report-ink-soft)]">
                以下条目仅供参考，可按你的节奏逐步补充。
              </p>
            </div>
          </div>
        </div>

        {/* 中部：问题清单（issues） */}
        {issues.length > 0 && (
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-[var(--navy-900)] mb-3">
              可以补充的内容
            </h3>
            <Container className="space-y-3" {...containerProps}>
              {issues.map((issue, i) => {
                const title = issue?.title?.trim() || "（待补充）";
                const detail = issue?.detail?.trim() || "—";
                const snippet = issue?.quotedSnippet?.trim() || "";
                const validPriorities = ["high", "medium", "low"] as const;
                const priority: "high" | "medium" | "low" =
                  validPriorities.includes(
                    issue?.priority as "high" | "medium" | "low",
                  )
                    ? (issue.priority as "high" | "medium" | "low")
                    : "medium";
                const tone = PRIORITY_TONE[priority];

                return (
                  <Item
                    key={i}
                    className="rounded-xl border border-[var(--blue-100)] bg-white p-4 break-inside-avoid"
                    {...itemProps}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <h4 className="text-[14.5px] font-semibold text-[var(--navy-900)] flex-1 min-w-0">
                        {title}
                      </h4>
                      <span
                        className="report-chip shrink-0"
                        {...(tone ? { "data-tone": tone } : {})}
                      >
                        {PRIORITY_LABEL[priority]}
                      </span>
                    </div>
                    <p className="text-[13.5px] leading-[1.75] text-[var(--navy-800)]">
                      {detail}
                    </p>
                    {snippet && (
                      <div className="report-quote mt-3">
                        <span className="opacity-60 mr-1.5 not-italic">
                          原文
                        </span>
                        {snippet}
                      </div>
                    )}
                  </Item>
                );
              })}
            </Container>
          </div>
        )}

        {/* 底部：改进建议（suggestions） */}
        {suggestions.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-[var(--navy-900)] mb-3">
              改进建议
            </h3>
            <Container className="space-y-2.5" {...containerProps}>
              {suggestions.map((s, i) => {
                const title = s?.title?.trim() || "（待补充）";
                const detail = s?.detail?.trim() || "—";
                return (
                  <Item key={i} className="report-takeaway" {...itemProps}>
                    <div className="text-[14px] font-semibold text-[var(--navy-900)] mb-1">
                      {title}
                    </div>
                    <div className="text-[13.5px] leading-[1.7] text-[var(--navy-800)]">
                      {detail}
                    </div>
                  </Item>
                );
              })}
            </Container>
          </div>
        )}

        {/* 两端皆空时的兜底 */}
        {issues.length === 0 && suggestions.length === 0 && (
          <p className="text-[13.5px] text-[var(--report-ink-soft)]">
            暂无具体反馈条目。
          </p>
        )}
      </div>
    </SectionWrapper>
  );
}
