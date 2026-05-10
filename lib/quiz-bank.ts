import type {
  QuizBank,
  QuizQuestion,
  QuizDimension,
  QuizBankDimension,
} from "./types";
import bankData from "../data/quiz-bank.json";

// 维度抽样的固定顺序（与 types.ts QuizDimension 顺序一致）
const DIMENSION_ORDER: QuizDimension[] = [
  "personality",
  "workstyle",
  "value",
  "direction",
];

/**
 * 加载题库 — JSON 里 question 按"位置定义维度"，loadQuizBank 自动注入 dimension 字段
 * 这样下游（scoring / sampleQuestions / 前端）拿到的都是完整 QuizQuestion[]
 */
export function loadQuizBank(): QuizBank {
  const raw = bankData as {
    version: string;
    dimensions: {
      key: QuizDimension;
      name: string;
      questions: Omit<QuizQuestion, "dimension">[];
    }[];
  };
  return {
    version: raw.version,
    dimensions: raw.dimensions.map((dim) => ({
      ...dim,
      questions: dim.questions.map((q) => ({ ...q, dimension: dim.key })),
    })),
  };
}

/**
 * 纯函数式 Fisher-Yates 洗牌（不污染入参）
 */
function shuffle<T>(arr: readonly T[]): T[] {
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 每维度抽 perDimension 题，返回扁平数组
 * 顺序：先按 DIMENSION_ORDER 固定维度顺序，再每维内随机
 *
 * @param contextFilter 身份过滤标签列表，如 ["all", "grad"] 或 ["all", "work"]；
 *   传 undefined 则不过滤（兼容旧调用方）
 */
export function sampleQuestions(
  bank: QuizBank,
  perDimension = 2,
  contextFilter?: string[],
): QuizQuestion[] {
  const result: QuizQuestion[] = [];
  for (const key of DIMENSION_ORDER) {
    const dim = bank.dimensions.find((d) => d.key === key);
    if (!dim) {
      throw new Error(`抽样失败：维度 ${key} 在题库中缺失`);
    }
    // 按 context 过滤（无 context 字段的题默认视为 "all"）
    const eligible = contextFilter
      ? dim.questions.filter(
          (q) => !q.context || contextFilter.includes(q.context),
        )
      : dim.questions;
    if (eligible.length < perDimension) {
      throw new Error(
        `抽样失败：维度 ${key} 过滤后题目数 ${eligible.length} < perDimension ${perDimension}`,
      );
    }
    const shuffled = shuffle(eligible);
    result.push(...shuffled.slice(0, perDimension));
  }
  return result;
}

/**
 * 校验题库结构合法性，失败抛 Error
 * - 4 个 dimension key 完整（personality/workstyle/value/direction）
 * - 每维度 questions.length >= perDimensionMin（默认 5）
 * - 每题 weights 数值在 [0, 1.0]
 * - reverse 必须是 boolean
 * - id 不重复
 */
export function validateBank(bank: QuizBank, perDimensionMin = 5): void {
  if (!bank || !Array.isArray(bank.dimensions)) {
    throw new Error("题库结构非法：bank.dimensions 必须为数组");
  }

  // 1. 维度完整性校验
  const presentKeys = new Set(bank.dimensions.map((d) => d.key));
  for (const required of DIMENSION_ORDER) {
    if (!presentKeys.has(required)) {
      throw new Error(`题库校验失败：维度 ${required} 缺失`);
    }
  }

  const seenIds = new Set<string>();

  for (const dim of bank.dimensions) {
    // 2. 维度 key 合法性
    if (!DIMENSION_ORDER.includes(dim.key)) {
      throw new Error(`题库校验失败：未知维度 key=${dim.key}`);
    }

    // 3. 每维度题量校验
    if (!Array.isArray(dim.questions)) {
      throw new Error(`题库校验失败：维度 ${dim.key} questions 必须为数组`);
    }
    if (dim.questions.length < perDimensionMin) {
      throw new Error(
        `题库校验失败：维度 ${dim.key} 题目数 ${dim.questions.length} < perDimensionMin ${perDimensionMin}`,
      );
    }

    // 4. 逐题校验
    for (const q of dim.questions) {
      if (!q.id || typeof q.id !== "string") {
        throw new Error(
          `题库校验失败：维度 ${dim.key} 存在题目缺失合法 id`,
        );
      }
      if (seenIds.has(q.id)) {
        throw new Error(`题库校验失败：题 id ${q.id} 重复`);
      }
      seenIds.add(q.id);

      // dimension 字段由 loadQuizBank() 注入，此处不再校验一致性

      if (typeof q.reverse !== "boolean") {
        throw new Error(
          `题库校验失败：题 ${q.id} reverse 必须是 boolean，当前为 ${typeof q.reverse}`,
        );
      }

      if (!q.weights || typeof q.weights !== "object") {
        throw new Error(`题库校验失败：题 ${q.id} weights 必须为对象`);
      }

      for (const [abilityKey, value] of Object.entries(q.weights)) {
        if (typeof value !== "number" || Number.isNaN(value)) {
          throw new Error(
            `题库校验失败：题 ${q.id} weights.${abilityKey}=${value} 不是合法数值`,
          );
        }
        if (value < 0 || value > 1.0) {
          throw new Error(
            `题库校验失败：题 ${q.id} weights.${abilityKey}=${value} 超出 [0, 1] 范围`,
          );
        }
      }
    }
  }
}
