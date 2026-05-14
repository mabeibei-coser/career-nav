/**
 * Report 章节后台 runner（career-nav 5 模块版）
 * ———————————————
 * 调度时序（分两批）：
 *   - quiz 提交 → startAfterQuiz(payload)
 *     启动 overview(1) / positioning(3) / resumeDiagnosis(4)
 *   - interview Q2 答完 → startAfterQ2(payload)
 *     启动 strength(2) / advice(5)，携带 Q1+Q2 答案
 *   - interview 完成 → 跳 loading 页 → consumeBgSections 合并两批 promise
 *
 * 防刷新丢失：两个 startAfter* 各自把 fingerprint 写 sessionStorage；loading 页
 * consumeAll 检测到内存 miss 但 sessionStorage 有标记，现场重新 fetch。
 */

import type { JobFormData, QuizAnswer, ScoringResult } from "@/lib/types";
import type { ReportSectionKey } from "@/lib/types";
import {
  startAfterQuiz as clientStartAfterQuiz,
  startAfterQ2 as clientStartAfterQ2,
  type StartPayload,
} from "@/lib/report-client";

export type BgSectionKey = ReportSectionKey;

interface BgState {
  fingerprint: string;
  promises: Map<BgSectionKey, Promise<unknown>>;
  startedAt: number;
}

let pendingAfterQuiz: BgState | null = null;
let pendingAfterQ2: BgState | null = null;

const SS_KEY_AFTER_QUIZ = "career-nav:bg-runner:afterQuiz";
const SS_KEY_AFTER_Q2   = "career-nav:bg-runner:afterQ2";

function fingerprintForm(formData: JobFormData, quizAnswers: QuizAnswer[]): string {
  const resumeHash = formData.resumeText?.slice(0, 50) ?? "";
  const formPart = [
    formData.identity,
    formData.targetPosition,
    formData.education,
    formData.workYears,
    resumeHash,
  ].join("|");
  const quizPart = quizAnswers
    .map((a) => `${a.questionId}:${a.selectedLabel}`)
    .join(",");
  return `${formPart}#${quizPart}`;
}

function fingerprintWithInterview(
  formData: JobFormData,
  quizAnswers: QuizAnswer[],
  q1q2: { Q1?: string; Q2?: string }
): string {
  const base = fingerprintForm(formData, quizAnswers);
  const q1Hash = (q1q2.Q1 ?? "").slice(0, 60);
  const q2Hash = (q1q2.Q2 ?? "").slice(0, 60);
  return `${base}@@${q1Hash}::${q2Hash}`;
}

function writeSessionMark(key: string, fingerprint: string) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(key, fingerprint); } catch { /* ignore */ }
}

function readSessionMark(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}

function clearSessionMark(key: string) {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(key); } catch { /* ignore */ }
}

// ========== Public API ==========

/**
 * quiz 提交后调用：启动 overview / positioning / resumeDiagnosis。
 * 重入幂等：相同 fingerprint 已 pending 则跳过。
 */
export function startAfterQuiz(payload: StartPayload): void {
  if (typeof window === "undefined") return;
  const fp = fingerprintForm(payload.formData, payload.quizAnswers);
  if (pendingAfterQuiz && pendingAfterQuiz.fingerprint === fp) {
    console.info("[bg-runner] startAfterQuiz hit (idempotent)", { fp: fp.slice(0, 50) });
    return;
  }
  const promises = clientStartAfterQuiz(payload);
  pendingAfterQuiz = { fingerprint: fp, promises, startedAt: Date.now() };
  writeSessionMark(SS_KEY_AFTER_QUIZ, fp);
  console.info("[bg-runner] startAfterQuiz fired (sections 1,3,4)", { fp: fp.slice(0, 50) });
}

/**
 * interview Q2 答完后调用：启动 strength / advice，携带 Q1+Q2 答案。
 * 重入幂等：相同 fingerprint 已 pending 则跳过。
 */
export function startAfterQ2(payload: StartPayload): void {
  if (typeof window === "undefined") return;
  const fp = fingerprintWithInterview(
    payload.formData,
    payload.quizAnswers,
    payload.interviewQ1Q2 ?? {}
  );
  if (pendingAfterQ2 && pendingAfterQ2.fingerprint === fp) {
    console.info("[bg-runner] startAfterQ2 hit (idempotent)", { fp: fp.slice(0, 50) });
    return;
  }
  const promises = clientStartAfterQ2(payload);
  pendingAfterQ2 = { fingerprint: fp, promises, startedAt: Date.now() };
  writeSessionMark(SS_KEY_AFTER_Q2, fp);
  console.info("[bg-runner] startAfterQ2 fired (sections 2,5)", { fp: fp.slice(0, 50) });
}

/** @deprecated 已废弃，no-op */
export function startAfterQ3(_payload: StartPayload): void {
  // no-op：报告生成已移至 startAfterQuiz + startAfterQ2
}

/** @deprecated 已废弃，no-op */
export function startAfterQ1Q2(_payload: StartPayload): void {
  // no-op
}

/**
 * loading 页 mount 时调用：合并 afterQuiz + afterQ2 两批内存 promise。
 *
 * 行为：
 * 1. 内存 promise 命中 → 返回合并 Map
 * 2. 内存 miss 但 sessionStorage 有标记 → 返回空 Map，让 consumeAll 现场 fetch
 * 3. 双双 miss → 返回 null，consumeAll 全量现场 fetch
 */
export function consumeBgSections(
  formData: JobFormData,
  quizAnswers: QuizAnswer[]
): Map<BgSectionKey, Promise<unknown>> | null {
  if (typeof window === "undefined") return null;

  const fpForm = fingerprintForm(formData, quizAnswers);
  const out = new Map<BgSectionKey, Promise<unknown>>();
  let anyHit = false;
  let anyMiss = false;

  // --- afterQuiz batch ---
  if (pendingAfterQuiz && pendingAfterQuiz.fingerprint === fpForm) {
    for (const [k, p] of pendingAfterQuiz.promises) out.set(k, p);
    anyHit = true;
    console.info("[bg-runner] consume hit (afterQuiz)", { count: pendingAfterQuiz.promises.size });
  } else {
    if (pendingAfterQuiz) {
      console.warn("[bg-runner] afterQuiz fingerprint mismatch, dropping");
      pendingAfterQuiz = null;
    }
    const ss = readSessionMark(SS_KEY_AFTER_QUIZ);
    if (ss) {
      console.info("[bg-runner] afterQuiz miss (refresh detected)");
      anyMiss = true;
    }
  }

  // --- afterQ2 batch（fingerprint 含 Q1Q2 哈希，loading 页不知访谈内容，只比前缀） ---
  if (pendingAfterQ2 && pendingAfterQ2.fingerprint.startsWith(fpForm + "@@")) {
    for (const [k, p] of pendingAfterQ2.promises) out.set(k, p);
    anyHit = true;
    console.info("[bg-runner] consume hit (afterQ2)", { count: pendingAfterQ2.promises.size });
  } else {
    if (pendingAfterQ2) {
      console.warn("[bg-runner] afterQ2 fingerprint mismatch, dropping");
      pendingAfterQ2 = null;
    }
    const ss = readSessionMark(SS_KEY_AFTER_Q2);
    if (ss) {
      console.info("[bg-runner] afterQ2 miss (refresh detected)");
      anyMiss = true;
    }
  }

  if (anyHit || anyMiss) {
    // 有命中或 sessionStorage 标记 → 返回合并 Map（部分 key 可能缺失，consumeAll 会现场 fetch）
    return out;
  }

  console.info("[bg-runner] consume null (never started or skipped interview)");
  return null;
}

/**
 * 报告生成完成或用户主动重置时调用：清空内存 + sessionStorage。
 */
export function clearBgSections(): void {
  pendingAfterQuiz = null;
  pendingAfterQ2 = null;
  clearSessionMark(SS_KEY_AFTER_QUIZ);
  clearSessionMark(SS_KEY_AFTER_Q2);
}
