/**
 * Quiz 题目内存缓存（Node.js 进程级单例）
 *
 * Key: `${identity}:${education}`（共 3×5=15 种组合），TTL 6 小时
 *
 * ⚠️ 使用 global.__quizCache 而非 module-level Map：
 * Next.js 把 instrumentation.ts（预热）和 API route 编译成独立 bundle，
 * 每个 bundle 有独立的 module 实例，module-level Map 无法跨 bundle 共享。
 * global 对象是整个 Node.js 进程唯一的，两侧都能读写同一份缓存。
 */
import type { QuizQuestion } from "@/lib/types";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEntry {
  questions: QuizQuestion[];
  cachedAt: number;
}

// TypeScript global 类型声明
declare global {
  // eslint-disable-next-line no-var
  var __quizCache: Map<string, CacheEntry> | undefined;
}

// 懒初始化：首次调用时创建，后续调用复用同一个 Map
function getCache(): Map<string, CacheEntry> {
  if (!global.__quizCache) {
    global.__quizCache = new Map<string, CacheEntry>();
  }
  return global.__quizCache;
}

export function makeQuizCacheKey(identity?: string, education?: string): string {
  return `${identity ?? "unknown"}:${education ?? "unknown"}`;
}

export function getFromQuizCache(key: string): QuizQuestion[] | null {
  const cache = getCache();
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.questions;
}

export function setToQuizCache(key: string, questions: QuizQuestion[]): void {
  getCache().set(key, { questions, cachedAt: Date.now() });
}
