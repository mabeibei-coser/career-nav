import { NextRequest, NextResponse } from "next/server";
import { getFixedQuestions } from "@/lib/quiz-bank";
import { generateSJTQuestions, FALLBACK_GENERATED } from "@/lib/quiz-generate";
import type { JobFormData } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/quiz/bank
 * Body: { formData: JobFormData }（或兼容旧 { identity }）
 *
 * 返回 8 道 SJT 完整题：Q1（固定）+ Q2-Q8（LLM 生成 / 兜底）。
 * @deprecated 推荐改用 /api/quiz/bank/q1（立即拿 Q1）+ /api/quiz/bank/generated（后台拿 7 题），
 *             这样用户在做 Q1 时 LLM 在后台生成，不会有 5-15s 的白屏等待。
 *             保留此端点用于兼容旧测试 / GET 兜底。
 */
export async function POST(req: NextRequest) {
  try {
    let formData: Partial<JobFormData> = {};
    try {
      const body = await req.json();
      formData = body?.formData ?? { identity: body?.identity };
    } catch {
      // body 解析失败，使用默认
    }

    // Q1 固定题
    const fixedQuestions = getFixedQuestions();
    if (fixedQuestions.length === 0) {
      console.error("[quiz/bank] fixedQuestions 为空，检查 data/quiz-bank.json");
      return NextResponse.json({ errorMessage: "固定题目缺失" }, { status: 503 });
    }
    const q1 = fixedQuestions[0];

    // E2E Mock 模式：直接返回固定题 + 兜底题
    if (process.env.E2E_MOCK_MODE === "true") {
      return NextResponse.json(
        { questions: [q1, ...FALLBACK_GENERATED], version: "mock" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    let generatedQuestions;
    try {
      generatedQuestions = await generateSJTQuestions(formData);
    } catch (llmErr) {
      console.warn(
        "[quiz/bank] LLM 生成失败，使用兜底题：",
        llmErr instanceof Error ? llmErr.message : llmErr,
      );
      generatedQuestions = FALLBACK_GENERATED;
    }

    return NextResponse.json(
      {
        questions: [q1, ...generatedQuestions],
        version: new Date().toISOString().slice(0, 10),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "quiz-bank load failed";
    console.error("[api/quiz/bank] error:", msg);
    try {
      const q1 = getFixedQuestions()[0];
      return NextResponse.json(
        { questions: [q1, ...FALLBACK_GENERATED], version: "fallback" },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return NextResponse.json({ errorMessage: msg }, { status: 503 });
    }
  }
}

// GET 兼容（旧缓存请求），直接返回兜底题
export async function GET() {
  try {
    const q1 = getFixedQuestions()[0];
    return NextResponse.json(
      { questions: [q1, ...FALLBACK_GENERATED], version: "fallback-get" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { errorMessage: e instanceof Error ? e.message : "error" },
      { status: 503 },
    );
  }
}
