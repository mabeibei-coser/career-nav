/**
 * Quiz 缓存预热（服务器启动时调用）
 *
 * 遍历所有 3×5=15 种 identity×education 组合，并发调用 LLM 生成题目写入缓存。
 * 预热完成后，所有用户首次请求直接命中缓存（0ms），不再等待 LLM。
 *
 * 调用方：instrumentation.ts（Next.js 服务器启动钩子）
 * 并发策略：每批 5 个，3 批共 15 个，每批 ~16s，总计 ~50s（后台执行不影响启动）
 */
import { generateSJTQuestions } from "@/lib/quiz-generate";
import { makeQuizCacheKey, getFromQuizCache, setToQuizCache } from "@/lib/quiz-cache";
import type { JobFormData } from "@/lib/types";

const IDENTITIES: Array<JobFormData["identity"]> = [
  "recent_grad",
  "young_unemployed",
  "general_unemployed",
];

const EDUCATIONS: string[] = [
  "junior_high",
  "high_school",
  "junior_college",
  "bachelor",
  "master_plus",
];

export async function warmQuizCache(): Promise<void> {
  // 只预热缓存为空的组合（重启时若缓存已有效则跳过）
  const combos: Array<{ identity: JobFormData["identity"]; education: string }> = [];
  for (const identity of IDENTITIES) {
    for (const education of EDUCATIONS) {
      const key = makeQuizCacheKey(identity, education);
      if (!getFromQuizCache(key)) {
        combos.push({ identity, education });
      }
    }
  }

  if (combos.length === 0) {
    console.log("[quiz-warmup] all 15 combos cached, skip");
    return;
  }

  console.log(`[quiz-warmup] warming ${combos.length} combo(s) serially...`);

  // 串行执行：避免并发触发 DeepSeek 限速
  // 15 × ~16s ≈ 4 分钟后台完成，不影响用户请求
  const failed: typeof combos = [];
  for (const { identity, education } of combos) {
    const key = makeQuizCacheKey(identity, education);
    try {
      const questions = await generateSJTQuestions({ identity, education });
      setToQuizCache(key, questions);
      console.log(`[quiz-warmup] ✓ ${key}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[quiz-warmup] ✗ ${key} — ${msg}`);
      failed.push({ identity, education });
    }
  }

  // 对失败的 combo 逐个重试一次（等 10s 后，避免短时限速）
  if (failed.length > 0) {
    console.log(`[quiz-warmup] retrying ${failed.length} failed combo(s) in 10s...`);
    await new Promise((r) => setTimeout(r, 10_000));
    for (const { identity, education } of failed) {
      const key = makeQuizCacheKey(identity, education);
      try {
        const questions = await generateSJTQuestions({ identity, education });
        setToQuizCache(key, questions);
        console.log(`[quiz-warmup] ✓ retry ok: ${key}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[quiz-warmup] ✗ retry failed: ${key} — ${msg}`);
      }
    }
  }

  console.log("[quiz-warmup] done");
}
