/**
 * Quiz 生成预触发单例（客户端专用）
 *
 * 在 form/page.tsx onSubmit 时立即发出 POST /api/quiz/bank/generated，
 * 而不是等到 quiz/page.tsx mount 后再发——节省 2-3s 页面过渡时间。
 *
 * quiz/page.tsx 通过 consumeQuizPrefetch() 拿到已在途的 Promise，
 * 直接 await 即可，不会重复发请求。
 */
import type { JobFormData, QuizQuestion } from "@/lib/types";

interface PrefetchState {
  formKey: string;
  promise: Promise<QuizQuestion[]>;
}

let pending: PrefetchState | null = null;

/** 用 identity + education + targetPosition 作 key（与服务端缓存 key 保持一致） */
function makeKey(fd: JobFormData): string {
  const base = `${fd.identity ?? ""}:${fd.education ?? ""}`;
  const pos = fd.targetPosition?.trim();
  return pos ? `${base}:${pos.slice(0, 30)}` : base;
}

/**
 * 在 form onSubmit 时调用。幂等：相同 key 不重复发请求。
 * Promise 失败由 consumeQuizPrefetch 的调用方处理。
 */
export function startQuizPrefetch(formData: JobFormData): void {
  if (typeof window === "undefined") return; // SSR 环境不执行

  const key = makeKey(formData);
  if (pending?.formKey === key) return; // 已在途，跳过

  const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  const p = fetch(`${BASE}/api/quiz/bank/generated`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formData }),
    cache: "no-store",
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { questions?: QuizQuestion[] };
      const qs = data?.questions ?? [];
      if (!Array.isArray(qs) || qs.length === 0) throw new Error("empty response");
      return qs;
    });

  p.catch(() => {}); // 静默未处理 rejection；quiz page 会处理错误
  pending = { formKey: key, promise: p };
}

/**
 * 在 quiz/page.tsx fetchBank 时调用。
 * - 返回已在途的 Promise（可能已 resolve 或仍在请求中）
 * - 消费一次后清空，不会被第二次调用复用
 * - 若 key 不匹配（用户回退重填），返回 null → 触发新请求
 */
export function consumeQuizPrefetch(formData: JobFormData): Promise<QuizQuestion[]> | null {
  if (!pending) return null;
  const key = makeKey(formData);
  if (pending.formKey !== key) return null;
  const p = pending.promise;
  pending = null; // 消费后清空
  return p;
}

/** 用户返回 form 页面时重置，防止携带旧请求 */
export function clearQuizPrefetch(): void {
  pending = null;
}
