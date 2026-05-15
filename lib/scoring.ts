/**
 * SJT（情境判断题）评分算法 — 双标签方案
 *
 * 题目结构（v0.10）：8 题 = 4 维 × 2 题/维
 *   - 每题绑定一个 dimension（personality/workstyle/value/direction）
 *   - 每个选项有 poleValue（0-100，所属维度光谱上的位置）
 *   - 每个选项还有 weights（6 能力副标签，给 positioning 用）
 *
 * ===== 4 维评估（总评雷达）=====
 * 主路径：按 dimension 分组题目 → 用户选项的 poleValue 平均 → 该维度 score（0-100）
 *   - 高分 = 偏右极（如外向/灵活/成长/多元），低分 = 偏左极（内敛/按部/稳定/深耕）
 *   - UI（overview-section）把 score 作为双极光谱上的位置展示
 * 兜底：旧题（无 dimension/poleValue）退化为 proxy 推导
 *   personality = avg(communication, collaboration)
 *   workstyle   = avg(execution, learning)
 *   direction   = avg(data, stress)
 *   value       = avg(learning, stress)
 *
 * ===== 6 能力评分（positioning 雷达图用）=====
 * 不变：累加 weights → 每能力得分 = 累计 / 理论最高 × 100
 */

import type { QuizAnswer, QuizQuestion, ScoringResult, AbilityKey, QuizDimension, DimensionScore, AbilityScore } from "./types";
import { QUIZ_DIMENSION_NAMES, ABILITY_NAMES } from "./types";

const ABILITY_ORDER: AbilityKey[] = [
  "communication",
  "collaboration",
  "execution",
  "learning",
  "data",
  "stress",
];

const DIMENSION_ORDER: QuizDimension[] = [
  "personality",
  "workstyle",
  "value",
  "direction",
];

/** 从 6 个能力分推导 4 个维度分的映射 */
const DIM_FROM_ABILITY: Record<QuizDimension, [AbilityKey, AbilityKey]> = {
  personality: ["communication", "collaboration"],
  workstyle: ["execution", "learning"],
  direction: ["data", "stress"],
  value: ["learning", "stress"], // proxy
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * SJT 评分主函数
 * @param answers 用户的答题记录（selectedLabel: "A"|"B"|"C"|"D"）
 * @param questions 完整题目列表（含每个选项的 weights）
 */
export function scoreQuiz(
  answers: QuizAnswer[],
  questions: QuizQuestion[]
): ScoringResult {
  // 构建 questionId → question 映射
  const qMap = new Map<string, QuizQuestion>();
  for (const q of questions) {
    qMap.set(q.id, q);
  }

  // 能力累计：achieved = 用户实际得分，maxPossible = 理论最高
  const achieved: Record<AbilityKey, number> = {
    communication: 0, collaboration: 0, execution: 0,
    learning: 0, data: 0, stress: 0,
  };
  const maxPossible: Record<AbilityKey, number> = {
    communication: 0, collaboration: 0, execution: 0,
    learning: 0, data: 0, stress: 0,
  };

  for (const ans of answers) {
    const q = qMap.get(ans.questionId);
    if (!q) continue; // 找不到题目跳过

    // 找到用户选择的选项
    const selected = q.options.find((o) => o.label === ans.selectedLabel);
    if (!selected) continue;

    // 对每个能力 key，累加本题的理论最高和实际得分
    for (const k of ABILITY_ORDER) {
      // 本题对能力 k 的理论最高 = 所有选项中该能力权重的最大值
      let maxW = 0;
      for (const opt of q.options) {
        const w = opt.weights[k] ?? 0;
        if (w > maxW) maxW = w;
      }
      if (maxW > 0) {
        // 该题参与能力 k 的评分
        maxPossible[k] += maxW;
        achieved[k] += selected.weights[k] ?? 0;
      }
    }
  }

  // ===== 能力雷达 =====
  const ability: AbilityScore[] = ABILITY_ORDER.map((k) => {
    let score: number;
    if (maxPossible[k] === 0) {
      score = 50; // 无题贡献 → 中性
    } else {
      score = (achieved[k] / maxPossible[k]) * 100;
    }
    return {
      key: k,
      name: ABILITY_NAMES[k],
      score: clamp(Math.round(score), 0, 100),
    };
  });

  // 构建 key → score 快速查找
  const abilityMap: Record<string, number> = {};
  for (const a of ability) abilityMap[a.key] = a.score;

  // ===== 四维评估 =====
  // 主路径：按 dimension 分组 → poleValue 平均
  // 兜底：旧题无 dimension/poleValue → proxy 推导（保持向后兼容）
  const dimAccum: Record<QuizDimension, { sum: number; count: number }> = {
    personality: { sum: 0, count: 0 },
    workstyle: { sum: 0, count: 0 },
    value: { sum: 0, count: 0 },
    direction: { sum: 0, count: 0 },
  };
  for (const ans of answers) {
    const q = qMap.get(ans.questionId);
    if (!q || !q.dimension) continue; // 旧题无 dimension，跳过（走兜底）
    const selected = q.options.find((o) => o.label === ans.selectedLabel);
    if (!selected || typeof selected.poleValue !== "number") continue;
    dimAccum[q.dimension].sum += selected.poleValue;
    dimAccum[q.dimension].count += 1;
  }

  const fourDim: DimensionScore[] = DIMENSION_ORDER.map((dim) => {
    let score: number;
    const { sum, count } = dimAccum[dim];
    if (count > 0) {
      // 主路径：poleValue 平均
      score = Math.round(sum / count);
    } else {
      // 兜底：proxy 推导
      const [k1, k2] = DIM_FROM_ABILITY[dim];
      score = Math.round((abilityMap[k1] + abilityMap[k2]) / 2);
    }
    return {
      dimension: dim,
      name: QUIZ_DIMENSION_NAMES[dim],
      score: clamp(score, 0, 100),
    };
  });

  return { fourDim, ability };
}
