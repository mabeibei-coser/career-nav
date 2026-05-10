import { NextResponse } from "next/server";
import { getFixedQuestions } from "@/lib/quiz-bank";

export const runtime = "nodejs";
export const maxDuration = 5;

/**
 * GET /api/quiz/bank/q1
 * 立即返回固定 Q1（来自 data/quiz-bank.json），不调 LLM。
 * 用于：用户进入 /quiz 后毫秒级显示第一题，让 Q2-Q8 异步在后台生成。
 */
export async function GET() {
  try {
    const fixedQuestions = getFixedQuestions();
    if (fixedQuestions.length === 0) {
      console.error("[quiz/bank/q1] fixedQuestions 为空，检查 data/quiz-bank.json");
      return NextResponse.json({ errorMessage: "固定题目缺失" }, { status: 503 });
    }
    return NextResponse.json(
      { question: fixedQuestions[0] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { errorMessage: e instanceof Error ? e.message : "q1 load failed" },
      { status: 503 },
    );
  }
}
