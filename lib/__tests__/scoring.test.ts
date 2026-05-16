import { describe, it, expect } from "vitest";
import { scoreQuiz } from "../scoring";
import type { QuizQuestion, QuizAnswer } from "../types";

/** 构造覆盖 6 个能力维度的 mock 题库（2 题） */
function makeMockQuestions(): QuizQuestion[] {
  return [
    {
      id: "SJT-01",
      text: "遇到陌生任务，你会怎么做？",
      options: [
        { label: "A", text: "边做边摸索", weights: { learning: 1.0, execution: 0.6 } },
        { label: "B", text: "先列步骤", weights: { execution: 1.0, data: 0.6 } },
        { label: "C", text: "找人请教", weights: { collaboration: 1.0, communication: 0.6 } },
        { label: "D", text: "主动告知上级", weights: { communication: 0.9, stress: 0.5 } },
      ],
    },
    {
      id: "SJT-02",
      text: "同时有三项任务，你怎么安排？",
      options: [
        { label: "A", text: "按紧急排序", weights: { execution: 1.0, stress: 0.5 } },
        { label: "B", text: "估算工作量分时间块", weights: { execution: 0.9, data: 0.7 } },
        { label: "C", text: "问哪项最优先", weights: { communication: 0.9, collaboration: 0.6 } },
        { label: "D", text: "先做能快速完成的", weights: { execution: 0.8, learning: 0.4 } },
      ],
    },
  ];
}

describe("scoreQuiz (SJT sparse matrix)", () => {
  it("t1: 两题都选 A → 能力得分能正确累计", () => {
    const questions = makeMockQuestions();
    const answers: QuizAnswer[] = [
      { questionId: "SJT-01", selectedLabel: "A" },
      { questionId: "SJT-02", selectedLabel: "A" },
    ];
    const result = scoreQuiz(answers, questions);

    // SJT-01 选 A: learning=1.0, execution=0.6
    // SJT-02 选 A: execution=1.0, stress=0.5
    // 所有维度得分应在 [0, 100]
    expect(result.fourDim).toHaveLength(4);
    expect(result.ability).toHaveLength(6);
    for (const d of result.fourDim) {
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(100);
    }
    for (const a of result.ability) {
      expect(a.score).toBeGreaterThanOrEqual(0);
      expect(a.score).toBeLessThanOrEqual(100);
    }
  });

  it("t2: 单题选最高权重选项 → 对应能力得分 100", () => {
    // 用单题、每能力只有一个选项有权重，使期望值可精确断言
    const isolatedQ: QuizQuestion[] = [
      {
        id: "ISO-01",
        text: "test",
        options: [
          { label: "A", text: "a", weights: { learning: 1.0 } },   // learning 最高
          { label: "B", text: "b", weights: { execution: 1.0 } },   // execution 最高
          { label: "C", text: "c", weights: { collaboration: 1.0 } },
          { label: "D", text: "d", weights: { stress: 1.0 } },
        ],
      },
    ];

    // 选 A → learning 应得 100（achieved=1.0, maxPossible=1.0）
    const answersA: QuizAnswer[] = [{ questionId: "ISO-01", selectedLabel: "A" }];
    const resultA = scoreQuiz(answersA, isolatedQ);
    const mapA = Object.fromEntries(resultA.ability.map((a) => [a.key, a.score]));
    expect(mapA.learning).toBe(100);
    // execution: max=1.0 (B), achieved=0 → score=0
    expect(mapA.execution).toBe(0);

    // 选 B → execution 应得 100
    const answersB: QuizAnswer[] = [{ questionId: "ISO-01", selectedLabel: "B" }];
    const resultB = scoreQuiz(answersB, isolatedQ);
    const mapB = Object.fromEntries(resultB.ability.map((a) => [a.key, a.score]));
    expect(mapB.execution).toBe(100);
    expect(mapB.learning).toBe(0);
  });

  it("t3: 无任何题贡献某能力时得分 = 50（默认中性）", () => {
    const noCollabQuestions: QuizQuestion[] = [
      {
        id: "NC-01",
        text: "test",
        options: [
          { label: "A", text: "a", weights: { execution: 1.0 } },
          { label: "B", text: "b", weights: { learning: 1.0 } },
          { label: "C", text: "c", weights: { data: 1.0 } },
          { label: "D", text: "d", weights: { stress: 1.0 } },
        ],
      },
    ];
    const answersNC: QuizAnswer[] = [{ questionId: "NC-01", selectedLabel: "A" }];
    const resultNC = scoreQuiz(answersNC, noCollabQuestions);
    const abilityMapNC = Object.fromEntries(resultNC.ability.map((a) => [a.key, a.score]));

    // collaboration 和 communication 在 noCollabQuestions 中没有任何选项有权重
    expect(abilityMapNC.collaboration).toBe(50);
    expect(abilityMapNC.communication).toBe(50);
  });

  it("t4: 不存在的 questionId 跳过不报错", () => {
    const questions = makeMockQuestions();
    const answers: QuizAnswer[] = [
      { questionId: "NOT-EXIST", selectedLabel: "A" },
      { questionId: "SJT-01", selectedLabel: "C" },
    ];
    expect(() => scoreQuiz(answers, questions)).not.toThrow();
    const result = scoreQuiz(answers, questions);
    // SJT-01 选 C: collaboration=1.0, communication=0.6
    const abilityMap = Object.fromEntries(result.ability.map((a) => [a.key, a.score]));
    expect(abilityMap.collaboration).toBe(100); // max=1.0, achieved=1.0
  });

  it("t5: 四维雷达从能力分正确推导", () => {
    // 构造一组使能力分可预期的答题
    const questions = makeMockQuestions();
    const answers: QuizAnswer[] = [
      { questionId: "SJT-01", selectedLabel: "C" }, // collaboration=1.0, communication=0.6
      { questionId: "SJT-02", selectedLabel: "C" }, // communication=0.9, collaboration=0.6
    ];
    const result = scoreQuiz(answers, questions);

    // personality = avg(communication, collaboration)
    const abilityMap = Object.fromEntries(result.ability.map((a) => [a.key, a.score]));
    const dimMap = Object.fromEntries(result.fourDim.map((d) => [d.dimension, d.score]));

    const expectedPersonality = Math.round((abilityMap.communication + abilityMap.collaboration) / 2);
    expect(dimMap.personality).toBe(expectedPersonality);

    // 所有维度有名字
    for (const d of result.fourDim) {
      expect(d.name).toBeTruthy();
    }
  });

  it("t6: 空答案数组返回全 50 分（无贡献默认中性）", () => {
    const questions = makeMockQuestions();
    const result = scoreQuiz([], questions);
    for (const a of result.ability) {
      expect(a.score).toBe(50);
    }
    // 维度分 = avg(50, 50) = 50
    for (const d of result.fourDim) {
      expect(d.score).toBe(50);
    }
  });
});
