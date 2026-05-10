/**
 * Report 章节后台 runner（career-nav 5 模块版）
 * ———————————————
 * 调度时序（简化后）：
 *   - interview 页 Q3 答完 → startAfterQ3(payload)
 *     一次性启动全部 5 个模块（overview / strength / positioning / resumeDiagnosis / advice）
 *     payload 携带 Q1+Q2+Q3 答案
 *   - Q4 纯粹缓冲时间，答案丢弃
 *   - interview 页 Q4 答完 → 跳 loading 页 → consumeBgSections 取出 5 个 promise
 *
 * 防刷新丢失：startAfterQ3 把 fingerprint 写 sessionStorage；loading 页
 * mount 时 consumeAll 检测到内存 miss 但 sessionStorage 有标记，由
 * report-client.consumeAll 现场重新 fetch。
 */

import type { JobFormData, QuizAnswer, ScoringResult } from "@/lib/types";
import type { ReportSectionKey } from "@/lib/types";
import {
  startAfterQ3 as clientStartAfterQ3,
  type StartPayload,
} from "@/lib/report-client";

export type BgSectionKey = ReportSectionKey;

interface BgState {
  fingerprint: string;
  promises: Map<BgSectionKey, Promise<unknown>>;
  startedAt: number;
}

let pendingAfterQ3: BgState | null = null;

const SS_KEY_AFTER_Q3 = "career-nav:bg-runner:afterQ3";

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
  q1q2q3: { Q1?: string; Q2?: string; Q3?: string }
): string {
  const base = fingerprintForm(formData, quizAnswers);
  const q1Hash = (q1q2q3.Q1 ?? "").slice(0, 60);
  const q2Hash = (q1q2q3.Q2 ?? "").slice(0, 60);
  const q3Hash = (q1q2q3.Q3 ?? "").slice(0, 60);
  return `${base}@@${q1Hash}::${q2Hash}::${q3Hash}`;
}

function writeSessionMark(key: string, fingerprint: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, fingerprint);
  } catch {
    // 隐私模式 / 配额满：忽略，仍走内存 promise 路径
  }
}

function readSessionMark(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearSessionMark(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ========== Public API ==========

/**
 * interview 页 Q3 答完后调用：一次性启动全部 5 个模块。
 * 重入幂等：相同 fingerprint 已 pending 则跳过；fingerprint 变化则覆盖。
 */
export function startAfterQ3(payload: StartPayload): void {
  if (typeof window === "undefined") return;
  const fp = fingerprintWithInterview(
    payload.formData,
    payload.quizAnswers,
    payload.interviewQ1Q2 ?? {}
  );
  if (pendingAfterQ3 && pendingAfterQ3.fingerprint === fp) {
    console.info("[bg-runner] startAfterQ3 hit (idempotent)", { fp: fp.slice(0, 50) });
    return;
  }
  const promises = clientStartAfterQ3(payload);
  pendingAfterQ3 = {
    fingerprint: fp,
    promises,
    startedAt: Date.now(),
  };
  writeSessionMark(SS_KEY_AFTER_Q3, fp);
  console.info("[bg-runner] startAfterQ3 fired (all 5 sections)", {
    fp: fp.slice(0, 50),
  });
}

/**
 * @deprecated quiz 提交后不再预热报告，改为 Q3 答完后统一触发。保留 no-op stub。
 */
export function startAfterQuiz(_payload: StartPayload): void {
  // no-op：报告生成已移至 startAfterQ3
}

/**
 * @deprecated Q1Q2 答完不再触发报告，改为 Q3 答完后统一触发。保留 no-op stub。
 */
export function startAfterQ1Q2(_payload: StartPayload): void {
  // no-op：报告生成已移至 startAfterQ3
}

/**
 * loading 页 mount 时调用：返回 afterQ3 的内存 promise Map。
 *
 * 行为：
 * 1. 内存 promise 命中 → 返回（含 reject 的 promise，consumer 会 catch）
 * 2. 内存 miss 但 sessionStorage 有标记 → 返回空 Map，让 consumeAll 现场 fetch
 * 3. 双双 miss → 返回 null，consumeAll 全量现场 fetch
 */
export function consumeBgSections(
  formData: JobFormData,
  quizAnswers: QuizAnswer[]
): Map<BgSectionKey, Promise<unknown>> | null {
  if (typeof window === "undefined") return null;

  const fpForm = fingerprintForm(formData, quizAnswers);

  // afterQ3：fingerprint 含 Q1Q2Q3 哈希，loading 页不知道访谈内容，
  // 所以只比较 fingerprint 的"form+quiz"前缀部分
  if (pendingAfterQ3 && pendingAfterQ3.fingerprint.startsWith(fpForm + "@@")) {
    const out = new Map<BgSectionKey, Promise<unknown>>();
    for (const [k, p] of pendingAfterQ3.promises) {
      out.set(k, p);
    }
    console.info("[bg-runner] consume hit (all 5 sections)", { count: out.size });
    return out;
  }

  // 内存 miss：清掉旧 state
  if (pendingAfterQ3) {
    console.warn("[bg-runner] afterQ3 fingerprint mismatch, dropping memory state");
    pendingAfterQ3 = null;
  }

  // 检查 sessionStorage —— 有标记说明"曾启动过、是刷新丢了"
  const ssAfterQ3 = readSessionMark(SS_KEY_AFTER_Q3);
  if (ssAfterQ3) {
    console.info("[bg-runner] consume miss (refresh detected)", {
      ssAfterQ3: ssAfterQ3.slice(0, 50),
    });
    return new Map(); // 空 Map → consumeAll 知道每个模块都要现场 fetch
  }

  console.info("[bg-runner] consume null (never started or skipped interview)");
  return null;
}

/**
 * 报告生成完成或用户主动重置时调用：清空内存 + sessionStorage。
 */
export function clearBgSections(): void {
  pendingAfterQ3 = null;
  clearSessionMark(SS_KEY_AFTER_Q3);
}
