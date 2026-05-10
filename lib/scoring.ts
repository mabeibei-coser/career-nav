/**
 * SJT（情境判断题）评分算法
 *
 * 原理：稀疏矩阵得分
 *   - 每题 4 个选项，每个选项覆盖 1-2 个能力维度（weights）
 *   - 用户选择某选项 → 该选项的 weights 累加进对应能力得分
 *   - 每个能力的最终得分 = 用户累计得分 / 理论最高得分 × 100
 *   - 若某题所有选项对某能力权重均为 0 → 该题不计入该能力
 *   - 若整个测试对某能力无任何贡献 → 默认 50（中性）
 *
 * 四维雷达从 6 个能力得分推导：
 *   personality  = avg(communication, collaboration)
 *   workstyle    = avg(execution, learning)
 *   direction    = avg(data, stress)
 *   value        = avg(learning, stress)  // proxy：成长心态 + 韧性 = 职业价值观倾向
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

  // ===== 四维雷达（从能力分推导）=====
  const fourDim: DimensionScore[] = DIMENSION_ORDER.map((dim) => {
    const [k1, k2] = DIM_FROM_ABILITY[dim];
    const score = Math.round((abilityMap[k1] + abilityMap[k2]) / 2);
    return {
      dimension: dim,
      name: QUIZ_DIMENSION_NAMES[dim],
      score: clamp(score, 0, 100),
    };
  });

  return { fourDim, ability };
}
