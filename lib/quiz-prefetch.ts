/**
 * Quiz 流式生成消费者（客户端单例）
 *
 * 在 form 提交时通过 startQuizStream() 开启 SSE 连接到 /api/quiz/stream，
 * 题目逐道到达时推入 questions 数组并通知订阅者。
 * quiz/page.tsx 通过 subscribeQuizStream() 实时消费。
 */
import type { JobFormData, QuizQuestion } from "@/lib/types";

interface QuizStreamState {
  formKey: string;
  questions: QuizQuestion[];
  done: boolean;
  error: string | null;
  listeners: Set<() => void>;
  abortController: AbortController;
}

let streamState: QuizStreamState | null = null;

function makeKey(fd: JobFormData): string {
  const base = `${fd.identity ?? ""}:${fd.education ?? ""}`;
  const pos = fd.targetPosition?.trim();
  return pos ? `${base}:${pos.slice(0, 30)}` : base;
}

function notifyListeners(state: QuizStreamState): void {
  for (const fn of state.listeners) {
    try { fn(); } catch { /* ignore listener errors */ }
  }
}

export function startQuizStream(formData: JobFormData): void {
  if (typeof window === "undefined") return;

  const key = makeKey(formData);
  if (streamState?.formKey === key && !streamState.done) return;

  streamState?.abortController.abort();

  const ac = new AbortController();
  const state: QuizStreamState = {
    formKey: key,
    questions: [],
    done: false,
    error: null,
    listeners: new Set(),
    abortController: ac,
  };
  streamState = state;

  const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  fetch(`${BASE}/api/quiz/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formData }),
    signal: ac.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        state.error = `HTTP ${res.status}`;
        state.done = true;
        notifyListeners(state);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);

          if (payload === "[DONE]") {
            state.done = true;
            notifyListeners(state);
            return;
          }

          try {
            const event = JSON.parse(payload) as { type: string; question?: QuizQuestion; message?: string };
            if (event.type === "question" && event.question) {
              state.questions.push(event.question);
              notifyListeners(state);
            } else if (event.type === "error") {
              state.error = event.message || "题目生成失败";
              notifyListeners(state);
            }
          } catch { /* malformed SSE event, skip */ }
        }
      }

      state.done = true;
      notifyListeners(state);
    })
    .catch((err) => {
      if (err instanceof Error && err.name === "AbortError") return;
      state.error = err instanceof Error ? err.message : "stream failed";
      state.done = true;
      notifyListeners(state);
    });
}

export function getQuizStreamSnapshot(formData: JobFormData): {
  questions: QuizQuestion[];
  done: boolean;
  error: string | null;
} | null {
  if (!streamState || streamState.formKey !== makeKey(formData)) return null;
  return {
    questions: streamState.questions,
    done: streamState.done,
    error: streamState.error,
  };
}

export function subscribeQuizStream(
  formData: JobFormData,
  listener: () => void,
): () => void {
  if (!streamState || streamState.formKey !== makeKey(formData)) {
    return () => {};
  }
  streamState.listeners.add(listener);
  const capturedState = streamState;
  return () => { capturedState.listeners.delete(listener); };
}

export function clearQuizStream(): void {
  streamState?.abortController.abort();
  streamState = null;
}

// Backward-compat aliases for app/page.tsx import
export const startQuizPrefetch = startQuizStream;
export const clearQuizPrefetch = clearQuizStream;
