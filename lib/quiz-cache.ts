/**
 * Quiz 题目内存缓存（Node.js 进程级单例）
 *
 * 从 app/api/quiz/bank/generated/route.ts 抽出，独立为 lib，
 * 供 quiz-warmup.ts（服务器启动预热）和 API 路由共用同一份缓存实例。
 *
 * Key: `${identity}:${education}`（共 3×5=15 种组合）
 * TTL: 6 小时
 */
import type { QuizQuestion } from "@/lib/types";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEntry {
  questions: QuizQuestion[];
  cachedAt: number;
}

const questionCache = new Map<string, CacheEntry>();

export function makeQuizCacheKey(identity?: string, education?: string): string {
  return `${identity ?? "unknown"}:${education ?? "unknown"}`;
}

export function getFromQuizCache(key: string): QuizQuestion[] | null {
  const entry = questionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    questionCache.delete(key);
    return null;
  }
  return entry.questions;
}

export function setToQuizCache(key: string, questions: QuizQuestion[]): void {
  questionCache.set(key, { questions, cachedAt: Date.now() });
}
