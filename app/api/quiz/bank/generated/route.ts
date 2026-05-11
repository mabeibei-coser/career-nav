import { NextRequest, NextResponse } from "next/server";
import { FALLBACK_GENERATED, generateSJTQuestions } from "@/lib/quiz-generate";
import { makeQuizCacheKey, getFromQuizCache, setToQuizCache } from "@/lib/quiz-cache";
import type { JobFormData } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/quiz/bank/generated
 * Body: { formData: JobFormData }
 * 返回：{ questions: QuizQuestion[6], version: string }
 *
 * LLM 个性化生成 SJT-03 到 SJT-08（6 道）。
 * 缓存由 lib/quiz-cache.ts 管理（与 instrumentation.ts 启动预热共享同一实例）。
 *
 * version 字段：
 *   "cached"  — 命中预热缓存，0ms，LLM 个性化题
 *   "warming" — 缓存未命中（预热还没跑到这个 combo），立即返回 FALLBACK，
 *               后台继续 warming，下次同 combo 将命中 "cached"
 */
export async function POST(req: NextRequest) {
  let formData: Partial<JobFormData> = {};
  try {
    const body = await req.json();
    formData = body?.formData ?? { identity: body?.identity };
  } catch {
    // body 解析失败，使用默认值
  }

  const cacheKey = makeQuizCacheKey(formData.identity, formData.education);

  // 缓存命中（instrumentation 预热 or 之前的 bg warm 成功）→ 0ms 返回 LLM 题
  const cached = getFromQuizCache(cacheKey);
  if (cached) {
    return NextResponse.json(
      { questions: cached, version: "cached" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // 缓存未命中（预热还未完成或失败）→ 立即返回 FALLBACK + 后台 warming
  generateSJTQuestions(formData)
    .then((questions) => {
      setToQuizCache(cacheKey, questions);
      console.log(`[quiz/bank/generated] bg warmed: ${cacheKey}`);
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[quiz/bank/generated] bg warm failed (${cacheKey}): ${msg}`);
    });

  return NextResponse.json(
    { questions: FALLBACK_GENERATED, version: "warming" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
