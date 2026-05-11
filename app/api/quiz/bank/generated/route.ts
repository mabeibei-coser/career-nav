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
 * 个性化逻辑（两层 key）：
 *   specificKey = identity:education:targetPosition  ← 按用户目标岗位个性化
 *   genericKey  = identity:education                 ← 预热的通用版（兜底）
 *
 * version 字段：
 *   "cached"    — 命中个性化或通用预热缓存，0ms
 *   "generated" — 本次等待 LLM 生成（prefetch 在 form submit 时已提前触发，通常 <5s 等待）
 *   "warming"   — 两层均未命中（预热还没跑到），返回 FALLBACK + 后台热身
 */
export async function POST(req: NextRequest) {
  let formData: Partial<JobFormData> = {};
  try {
    const body = await req.json();
    formData = body?.formData ?? { identity: body?.identity };
  } catch {
    // body 解析失败，使用默认值
  }

  const targetPos = formData.targetPosition?.trim() || undefined;
  const specificKey = makeQuizCacheKey(formData.identity, formData.education, targetPos);
  const genericKey  = makeQuizCacheKey(formData.identity, formData.education);

  // ── 1. 命中个性化缓存（最优，0ms）──────────────────────────────────────
  const specificCached = getFromQuizCache(specificKey);
  if (specificCached) {
    return NextResponse.json(
      { questions: specificCached, version: "cached" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── 2. 有目标岗位 → 同步等待个性化生成 ───────────────────────────────
  // prefetch 在 form submit 时已提前触发（~20s 前），此处等待时间极短。
  // 用户在 form→quiz 过渡 + 回答 Q1+Q2 的时间足以覆盖生成耗时（~20s）。
  if (targetPos) {
    try {
      const questions = await generateSJTQuestions(formData);
      setToQuizCache(specificKey, questions);
      console.log(`[quiz/bank/generated] generated: ${specificKey}`);
      return NextResponse.json(
        { questions, version: "generated" },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[quiz/bank/generated] generate failed (${specificKey}): ${msg}`);
      // 生成失败 → 降到通用预热兜底
    }
  }

  // ── 3. 命中通用预热缓存（0ms，无目标岗位或个性化生成失败时）────────────
  const genericCached = getFromQuizCache(genericKey);
  if (genericCached) {
    return NextResponse.json(
      { questions: genericCached, version: "cached" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── 4. 两层均未命中（预热还没跑到这个 combo）→ FALLBACK + 后台热身 ─────
  generateSJTQuestions({ identity: formData.identity, education: formData.education })
    .then((questions) => {
      setToQuizCache(genericKey, questions);
      console.log(`[quiz/bank/generated] bg warmed: ${genericKey}`);
    })
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[quiz/bank/generated] bg warm failed (${genericKey}): ${msg}`);
    });

  return NextResponse.json(
    { questions: FALLBACK_GENERATED, version: "warming" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
