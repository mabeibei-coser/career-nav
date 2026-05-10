import type { QuizBank, QuizQuestion } from "./types";
import bankData from "../data/quiz-bank.json";

/**
 * 加载题库（从 data/quiz-bank.json 读取）
 * SJT 版：只包含 fixedQuestions（Q1 固定题）
 * Q2-Q8 由 /api/quiz/bank 路由通过 LLM 动态生成
 */
export function loadQuizBank(): QuizBank {
  return bankData as unknown as QuizBank;
}

/**
 * 获取固定题目列表（目前只有 SJT-01）
 */
export function getFixedQuestions(): QuizQuestion[] {
  const bank = loadQuizBank();
  return bank.fixedQuestions ?? [];
}
