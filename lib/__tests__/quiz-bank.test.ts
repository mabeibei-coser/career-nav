import { describe, it, expect } from "vitest";
import { loadQuizBank, getFixedQuestions } from "../quiz-bank";

describe("loadQuizBank", () => {
  it("返回 QuizBank 对象，含 version 和 fixedQuestions", () => {
    const bank = loadQuizBank();
    expect(bank).toBeDefined();
    expect(typeof bank.version).toBe("string");
    expect(Array.isArray(bank.fixedQuestions)).toBe(true);
  });

  it("fixedQuestions 至少有 1 题（SJT-01）", () => {
    const bank = loadQuizBank();
    expect(bank.fixedQuestions.length).toBeGreaterThanOrEqual(1);
  });
});

describe("getFixedQuestions", () => {
  it("返回数组，每题有 id / text / options", () => {
    const questions = getFixedQuestions();
    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBeGreaterThanOrEqual(1);
    for (const q of questions) {
      expect(typeof q.id).toBe("string");
      expect(typeof q.text).toBe("string");
      expect(Array.isArray(q.options)).toBe(true);
    }
  });

  it("SJT-01 有 4 个选项 A/B/C/D", () => {
    const questions = getFixedQuestions();
    const q1 = questions[0];
    expect(q1.id).toBe("SJT-01");
    expect(q1.options).toHaveLength(4);
    const labels = q1.options.map((o) => o.label);
    expect(labels).toContain("A");
    expect(labels).toContain("B");
    expect(labels).toContain("C");
    expect(labels).toContain("D");
  });

  it("每个选项有 text 和 weights（至少 1 个能力 key）", () => {
    const questions = getFixedQuestions();
    for (const q of questions) {
      for (const opt of q.options) {
        expect(typeof opt.text).toBe("string");
        expect(opt.text.length).toBeGreaterThan(5);
        expect(typeof opt.weights).toBe("object");
        // SJT 选项稀疏矩阵：每个选项有 1-2 个 ability key
        const weightKeys = Object.keys(opt.weights);
        expect(weightKeys.length).toBeGreaterThanOrEqual(1);
        for (const [, v] of Object.entries(opt.weights)) {
          expect(typeof v).toBe("number");
          expect(v).toBeGreaterThan(0);
          expect(v).toBeLessThanOrEqual(1.0);
        }
      }
    }
  });
});
