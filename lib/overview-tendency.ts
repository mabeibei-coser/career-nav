/**
 * 总评章节双极倾向 + 反向词检测
 *
 * 用途：把前端展示给用户的"偏稳定 / 较均衡 / 偏探索"语义同时给到 LLM，
 * 并在生成结果上做反向词冲突校验（B 方案：servervalidator + retry hook）。
 *
 * 阈值/方向必须与前端 components/report/overview-section.tsx 完全对齐
 * （getTendencyLabel + BIPOLAR_POLES），否则会出现"前端显示偏探索，校验当成偏稳定"的诡异错位。
 */

import type { DimensionScore, Overview, QuizDimension } from "./types";

/** 双极标签：与前端 BIPOLAR_POLES 严格对齐，顺序同 DIMENSION_ORDER */
export const POLE_LABELS: Record<QuizDimension, { left: string; right: string }> = {
  personality: { left: "内敛沉稳", right: "主动外向" },
  workstyle: { left: "按部就班", right: "灵活应变" },
  value: { left: "稳定务实", right: "探索成长" },
  direction: { left: "专注深耕", right: "多元适应" },
};

export type Tendency = "left" | "center" | "right";

/** 与前端 getTendencyLabel 同阈值：≤40 偏左，≥61 偏右，其余均衡 */
export function getTendency(score: number): Tendency {
  if (score <= 40) return "left";
  if (score >= 61) return "right";
  return "center";
}

export function tendencyChip(score: number, dim: QuizDimension): string {
  const t = getTendency(score);
  const p = POLE_LABELS[dim];
  if (t === "left") return `偏${p.left.slice(0, 2)}`;
  if (t === "right") return `偏${p.right.slice(0, 2)}`;
  return "较均衡";
}

/**
 * 反向词词典：仅收录方向性强的核心词，宽松一些避免误判。
 * - personality.left 不收"沉稳"（"沉稳协调"在偏外向用户身上也通）
 * - value.left 不收"稳定"（"情绪稳定"会误命中）
 */
export const POLE_KEYWORDS: Record<QuizDimension, { left: string[]; right: string[] }> = {
  personality: {
    left: ["内敛", "内向", "沉静", "安静寡言"],
    right: ["外向", "活跃", "开朗", "热情奔放"],
  },
  workstyle: {
    left: ["按部就班", "守规", "保守", "刻板", "墨守成规"],
    right: ["灵活", "应变", "敏捷"],
  },
  value: {
    left: ["稳健", "务实", "守成", "本分", "安稳", "踏实肯干"],
    right: ["探索", "进取", "开拓", "野心", "拼搏", "突破"],
  },
  direction: {
    left: ["深耕", "专精", "钻研", "聚焦"],
    right: ["多元", "跨界", "广博"],
  },
};

export interface ReverseConflict {
  dimensionName: string;
  dimension: QuizDimension;
  tendency: "left" | "right";
  hits: string[];
  expectedSide: "left" | "right";
}

/**
 * 检测 personality.type + traits 拼接文本，是否含与四维主导倾向反向的核心词。
 * 较均衡维度（41-60）跳过——前端就显示"较均衡"，左右词都能搭。
 */
export function detectReverseWords(
  text: string,
  fourDim: DimensionScore[]
): ReverseConflict[] {
  const conflicts: ReverseConflict[] = [];
  for (const d of fourDim) {
    const t = getTendency(d.score);
    if (t === "center") continue;
    const dict = POLE_KEYWORDS[d.dimension];
    if (!dict) continue;
    const reverseList = t === "left" ? dict.right : dict.left;
    const hits = reverseList.filter((w) => text.includes(w));
    if (hits.length > 0) {
      conflicts.push({
        dimensionName: d.name,
        dimension: d.dimension,
        tendency: t,
        hits,
        expectedSide: t,
      });
    }
  }
  return conflicts;
}

export const REVERSE_WORD_ISSUE_PREFIX = "反向词冲突";

/**
 * 把 Overview 的所有自然语言字段拼成一段文本，供 detectReverseWords 一次扫完。
 * 覆盖：personality.type、traits、description、fourDimRadar[i].conclusion、summary。
 * 之前 validator 只扫 type+traits 是历史漏洞 —— LLM 把 type 写对、却在 conclusion/description
 * 里继续写反向词时会逃过校验（截图 bug 的成因之一）。
 */
export function collectAllOverviewText(d: Overview): string {
  return [
    d.personality?.type ?? "",
    ...(Array.isArray(d.personality?.traits) ? d.personality.traits : []),
    d.personality?.description ?? "",
    ...(Array.isArray(d.fourDimRadar)
      ? d.fourDimRadar.map((r) => r?.conclusion ?? "")
      : []),
    d.summary ?? "",
  ].join(" ");
}
