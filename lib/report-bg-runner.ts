/**
 * Report 章节后台 runner（career-nav 5 模块版 · 单请求模式）
 * ———————————————
 * 调度时序：
 *   - interview Q2 答完 → startAfterQ2(payload)
 *     触发 /api/report/generate（单次请求，内部顺序生成全部 5 个模块）
 *   - Q3/Q4 答案不入报告，仅作访谈体验缓冲（生成在此期间后台运行）
 *   - interview 完成 → 跳 loading 页 → consumeBgGeneratePromise 消费 promise
 *
 * 防刷新丢失：startAfterQ2 把 fingerprint 写 sessionStorage；loading 页
 * consumeAll 检测到内存 miss 但 sessionStorage 有标记时，现场重新 fetch。
 */

import type { JobFormData, QuizAnswer } from "@/lib/types";
import { clientFireGenerate, type StartPayload } from "@/lib/report-client";

// ---- 内部状态 ----

interface PendingGenerate {
  fingerprint: string;
  // Promise<unknown> 对外隐藏具体类型，consumeAll 内部会强制转换
  promise: Promise<unknown>;
  startedAt: number;
}

let pendingGenerate: PendingGenerate | null = null;

const SS_KEY = "career-nav:bg-runner:generate";

// ---- fingerprint helpers ----

function fingerprintForm(formData: JobFormData, quizAnswers: QuizAnswer[]): string {
  const resumeHash = formData.resumeText?.slice(0, 50) ?? "";
  const formPart = [
    formData.identity,
    formData.targetPosition,
    formData.education,
    formData.workYears,
    resumeHash,
  ].join("|");
  const quizPart = quizAnswers.map((a) => `${a.questionId}:${a.selectedLabel}`).join(",");
  return `${formPart}#${quizPart}`;
}

function fingerprintFull(
  formData: JobFormData,
  quizAnswers: QuizAnswer[],
  q1q2: { Q1?: string; Q2?: string }
): string {
  const base = fingerprintForm(formData, quizAnswers);
  const q1Hash = (q1q2.Q1 ?? "").slice(0, 60);
  const q2Hash = (q1q2.Q2 ?? "").slice(0, 60);
  return `${base}@@${q1Hash}::${q2Hash}`;
}

function writeSessionMark(fp: string) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(SS_KEY, fp); } catch { /* ignore */ }
}

function readSessionMark(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage.getItem(SS_KEY); } catch { return null; }
}

function clearSessionMark() {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(SS_KEY); } catch { /* ignore */ }
}

// ========== Public API ==========

/** @deprecated no-op */
export function startAfterQuiz(_payload: StartPayload): void {
  // no-op
}

/**
 * interview Q2 答完后调用：触发 /api/report/generate（单次请求，顺序生成全部模块）。
 * 重入幂等：相同 fingerprint 已 pending 则跳过。
 */
export function startAfterQ2(payload: StartPayload): void {
  if (typeof window === "undefined") return;
  const fp = fingerprintFull(
    payload.formData,
    payload.quizAnswers,
    payload.interviewQ1Q2 ?? {}
  );
  if (pendingGenerate && pendingGenerate.fingerprint === fp) {
    console.info("[bg-runner] startAfterQ2 idempotent hit", { fp: fp.slice(0, 50) });
    return;
  }
  const promise = clientFireGenerate(payload);
  promise.catch(() => {}); // 防 unhandled rejection 警告
  pendingGenerate = { fingerprint: fp, promise, startedAt: Date.now() };
  writeSessionMark(fp);
  console.info("[bg-runner] startAfterQ2 fired → /api/report/generate", { fp: fp.slice(0, 50) });
}

/** @deprecated no-op */
export function startAfterQ3(_payload: StartPayload): void {
  // no-op
}

/**
 * loading 页 mount 时调用：返回后台 generate promise 或 null。
 *
 * 行为：
 * 1. 内存 promise 命中（fingerprint 前缀匹配）→ 返回 Promise
 * 2. 内存 miss 但 sessionStorage 有标记（刷新场景）→ 返回 null，由 consumeAll 现场 fetch
 * 3. 双双 miss → 返回 null，consumeAll 全量现场 fetch
 */
export function consumeBgGeneratePromise(
  formData: JobFormData,
  quizAnswers: QuizAnswer[],
  q1q2: { Q1?: string; Q2?: string }
): Promise<unknown> | null {
  if (typeof window === "undefined") return null;

  const fp = fingerprintFull(formData, quizAnswers, q1q2);

  if (pendingGenerate && pendingGenerate.fingerprint === fp) {
    console.info("[bg-runner] consume hit (generate promise)", { age: Date.now() - pendingGenerate.startedAt });
    return pendingGenerate.promise;
  }

  // fingerprint 前缀匹配：loading 页不一定知道访谈内容，但 formData+quiz 相同即可
  const fpForm = fingerprintForm(formData, quizAnswers);
  if (pendingGenerate && pendingGenerate.fingerprint.startsWith(fpForm + "@@")) {
    console.info("[bg-runner] consume hit (prefix match)");
    return pendingGenerate.promise;
  }

  if (pendingGenerate) {
    console.warn("[bg-runner] fingerprint mismatch, dropping pending promise");
    pendingGenerate = null;
  }

  const ss = readSessionMark();
  if (ss) {
    console.info("[bg-runner] sessionStorage mark found (refresh detected), fresh fetch needed");
    return null;
  }

  console.info("[bg-runner] consume null (never started)");
  return null;
}

/**
 * 报告生成完成或用户主动重置时调用：清空内存 + sessionStorage。
 */
export function clearBgSections(): void {
  pendingGenerate = null;
  clearSessionMark();
}
