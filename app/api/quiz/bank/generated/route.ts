import { NextRequest, NextResponse } from "next/server";
import { FALLBACK_GENERATED } from "@/lib/quiz-generate";
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

    // 使用静态兜底题：毫秒级返回，避免 LLM 生成 5-15s 的白屏等待。
    // SJT 兜底题覆盖 6 个能力维度，评分权重完整，足以支撑报告生成。
    // 若未来需要个性化生成，可在此处按 identity 分流再开 LLM 调用。
    return NextResponse.json(
      {
        questions: FALLBACK_GENERATED,
        version: "static",
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
