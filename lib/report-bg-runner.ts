/**
 * Report 章节后台 runner（career-nav 5 模块版）
 * ———————————————
 * 调度时序：
 *   - quiz 第 8 题选完点"进入访谈" → startAfterQuiz(payload)
 *     启动 strength / positioning / advice（仅依赖 form + scoring）
 *   - interview 页 Q2 答完 → startAfterQ1Q2(payload)
 *     启动 overview / resumeDiagnosis（依赖 Q1Q2 摘要）
 *   - interview 页 Q4 答完 → 跳 loading 页 → consumeBgSections 取出 5 个 promise
 *
 * 防刷新丢失：每次 start 把 trigger + body hash 写 sessionStorage；loading 页
 * mount 时 consumeBgSections 检测到内存 miss 但 sessionStorage 有标记，会知道
 * "上一次确实启动过"，由 report-client.consumeAll 现场重新 fetch。
 *
 * 仅在浏览器 SPA 生命周期内有效；硬刷新会丢失内存 promise，但 sessionStorage
 * 标记会保留，consumeAll 据此走现场 fetch 路径。
 */

import type { JobFormData, QuizAnswer, ScoringResult } from "@/lib/types";
import type { ReportSectionKey } from "@/lib/types";
import {
  startAfterQuiz as clientStartAfterQuiz,
  startAfterQ1Q2 as clientStartAfterQ1Q2,
  type StartPayload,
} from "@/lib/report-client";

// 5 个模块按 trigger 分组
const TRIGGER_KEYS: Record<"afterQuiz" | "afterQ1Q2", ReportSectionKey[]> = {
  afterQuiz: ["strength", "positioning", "advice"],
  afterQ1Q2: ["overview", "resumeDiagnosis"],
};

export type BgSectionKey = ReportSectionKey;

interface BgState {
  fingerprint: string;
  promises: Map<BgSectionKey, Promise<unknown>>;
  startedAt: number;
}

// 模块级状态：两个 trigger 各自一份，互不影响（quiz 阶段启动后 interview 阶段
// 还能继续追加 Q1Q2 模块，不会互相覆盖）
let pendingAfterQuiz: BgState | null = null;
let pendingAfterQ1Q2: BgState | null = null;

const SS_KEY_AFTER_QUIZ = "career-nav:bg-runner:afterQuiz";
const SS_KEY_AFTER_Q1Q2 = "career-nav:bg-runner:afterQ1Q2";

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

function fingerprintFull(
  formData: JobFormData,
  quizAnswers: QuizAnswer[],
  q1q2: { Q1?: string; Q2?: string }
): string {
  const base = fingerprintForm(formData, quizAnswers);
  const q1Hash = (q1q2.Q1 ?? "").slice(0, 80);
  const q2Hash = (q1q2.Q2 ?? "").slice(0, 80);
  return `${base}@@${q1Hash}::${q2Hash}`;
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
 * quiz 提交后调用：启动 trigger=afterQuiz 的 3 个模块。
 * 重入幂等：相同 fingerprint 已 pending 则跳过；fingerprint 变化则覆盖（旧 promise
 * 不主动 abort —— 浏览器 SPA 内 fetch 占用极小，让它自然完成或失败即可）。
 */
export function startAfterQuiz(payload: StartPayload): void {
  if (typeof window === "undefined") return;
  const fp = fingerprintForm(payload.formData, payload.quizAnswers);
  if (pendingAfterQuiz && pendingAfterQuiz.fingerprint === fp) {
    console.info("[bg-runner] startAfterQuiz hit", { fp: fp.slice(0, 40) });
    return;
  }
  const promises = clientStartAfterQuiz(payload);
  pendingAfterQuiz = {
    fingerprint: fp,
    promises,
    startedAt: Date.now(),
  };
  writeSessionMark(SS_KEY_AFTER_QUIZ, fp);
  console.info("[bg-runner] startAfterQuiz", {
    fp: fp.slice(0, 40),
    keys: TRIGGER_KEYS.afterQuiz,
  });
}

/**
 * interview 页 Q2 答完调用：启动 trigger=afterQ1Q2 的 2 个模块。
 * payload.interviewQ1Q2 必须带上至少 Q1（Q2 可空但建议带）。
 */
export function startAfterQ1Q2(payload: StartPayload): void {
  if (typeof window === "undefined") return;
  const fp = fingerprintFull(
    payload.formData,
    payload.quizAnswers,
    payload.interviewQ1Q2 ?? {}
  );
  if (pendingAfterQ1Q2 && pendingAfterQ1Q2.fingerprint === fp) {
    console.info("[bg-runner] startAfterQ1Q2 hit", { fp: fp.slice(0, 40) });
    return;
  }
  const promises = clientStartAfterQ1Q2(payload);
  pendingAfterQ1Q2 = {
    fingerprint: fp,
    promises,
    startedAt: Date.now(),
  };
  writeSessionMark(SS_KEY_AFTER_Q1Q2, fp);
  console.info("[bg-runner] startAfterQ1Q2", {
    fp: fp.slice(0, 40),
    keys: TRIGGER_KEYS.afterQ1Q2,
  });
}

/**
 * loading 页 mount 时调用：合并两个 trigger 的内存 promise 输出统一 Map。
 *
 * 行为：
 * 1. 内存 promise 命中 → 直接返回（含 reject 的 promise，consumer 会 catch）
 * 2. 内存 miss 但 sessionStorage 有标记 → 提示 consumer "曾启动过，请现场 fetch"，
 *    返回部分 Map（命中的）+ 缺失项不写入 → consumeAll 检测到 undefined 时
 *    会现场 fetch fallbackPayload。
 * 3. 双双 miss（首次访问或刷新前从未启动）→ 返回 null，consumer 判 null 时
 *    全量现场 fetch。
 */
export function consumeBgSections(
  formData: JobFormData,
  quizAnswers: QuizAnswer[]
): Map<BgSectionKey, Promise<unknown>> | null {
  if (typeof window === "undefined") return null;

  const fpForm = fingerprintForm(formData, quizAnswers);
  const out = new Map<BgSectionKey, Promise<unknown>>();
  let anyHit = false;

  // afterQuiz
  if (pendingAfterQuiz && pendingAfterQuiz.fingerprint === fpForm) {
    for (const [k, p] of pendingAfterQuiz.promises) {
      out.set(k, p);
    }
    anyHit = true;
  } else {
    // 指纹不匹配：清掉旧 state（不影响 sessionStorage —— 那是给 consumeAll
    // 判断"是否曾启动"用的，这里的内存 state 只是优化）
    if (pendingAfterQuiz) {
      console.warn("[bg-runner] afterQuiz fingerprint mismatch, dropping memory state");
      pendingAfterQuiz = null;
    }
  }

  // afterQ1Q2：fingerprint 含 Q1Q2 哈希，但 consumeBgSections 调用时 loading 页
  // 不一定知道 Q1Q2，所以这里只比 fingerprint 的"前缀"（form+quiz 部分）。
  // 如果同一会话里 Q1Q2 有变化，pending 也会因为 startAfterQ1Q2 重启而被覆盖。
  if (pendingAfterQ1Q2 && pendingAfterQ1Q2.fingerprint.startsWith(fpForm + "@@")) {
    for (const [k, p] of pendingAfterQ1Q2.promises) {
      out.set(k, p);
    }
    anyHit = true;
  } else {
    if (pendingAfterQ1Q2) {
      console.warn("[bg-runner] afterQ1Q2 fingerprint mismatch, dropping memory state");
      pendingAfterQ1Q2 = null;
    }
  }

  if (anyHit) {
    console.info("[bg-runner] consume hit", { count: out.size });
    return out;
  }

  // 内存全 miss：检查 sessionStorage —— 如有标记说明"曾启动过、是刷新丢了"，
  // 返回空 Map（非 null），让 consumeAll 知道每个模块都得现场 fetch
  const ssAfterQuiz = readSessionMark(SS_KEY_AFTER_QUIZ);
  const ssAfterQ1Q2 = readSessionMark(SS_KEY_AFTER_Q1Q2);
  if (ssAfterQuiz || ssAfterQ1Q2) {
    console.info("[bg-runner] consume miss (refresh detected via sessionStorage)", {
      ssAfterQuiz: ssAfterQuiz?.slice(0, 40),
      ssAfterQ1Q2: ssAfterQ1Q2?.slice(0, 40),
    });
    return new Map();
  }

  console.info("[bg-runner] consume null (never started)");
  return null;
}

/**
 * 报告生成完成或用户主动重置时调用：清空内存 + sessionStorage。
 */
export function clearBgSections(): void {
  pendingAfterQuiz = null;
  pendingAfterQ1Q2 = null;
  clearSessionMark(SS_KEY_AFTER_QUIZ);
  clearSessionMark(SS_KEY_AFTER_Q1Q2);
}
