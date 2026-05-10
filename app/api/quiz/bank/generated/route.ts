import { NextRequest, NextResponse } from "next/server";
import { generateSJTQuestions, FALLBACK_GENERATED } from "@/lib/quiz-generate";
import type { JobFormData } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/quiz/bank/generated
 * Body: { formData: JobFormData }
 * 返回：{ questions: QuizQuestion[7], version: string }
 *
 * LLM 生成 SJT-02 到 SJT-08（7 道），失败时使用兜底题。
 * 与 /api/quiz/bank/q1 配合使用：前端先拉 Q1 立即显示，本端点在后台异步生成。
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

    // E2E Mock 模式：直接返回兜底题
    if (process.env.E2E_MOCK_MODE === "true") {
      return NextResponse.json(
        { questions: FALLBACK_GENERATED, version: "mock" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    let generatedQuestions;
    try {
      generatedQuestions = await generateSJTQuestions(formData);
    } catch (llmErr) {
      console.warn(
        "[quiz/bank/generated] LLM 生成失败，使用兜底题：",
        llmErr instanceof Error ? llmErr.message : llmErr,
      );
      generatedQuestions = FALLBACK_GENERATED;
    }

    return NextResponse.json(
      {
        questions: generatedQuestions,
        version: new Date().toISOString().slice(0, 10),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "generated load failed";
    console.error("[api/quiz/bank/generated] error:", msg);
    // 最后兜底：返回硬编码 7 道
    return NextResponse.json(
      { questions: FALLBACK_GENERATED, version: "fallback" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
