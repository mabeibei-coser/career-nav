/**
 * Report 章节前端并发调度器（5 模块版）
 * ———————————————
 * 触发时序（单批）：
 *   - interview Q2 答完 → startAfterQ2 → 同时启动全部 5 个模块，携带 Q1+Q2 答案
 * loading 页 mount 时调 consumeAll 消费结果。
 * Q3/Q4 答案不入报告，仅作访谈体验缓冲。
 */
import type {
  Advice,
  JobFormData,
  Overview,
  Positioning,
  QuizAnswer,
  ReportData,
  ReportMeta,
  ReportSectionKey,
  ResumeDiagnosis,
  ScoringResult,
  Strength,
} from "@/lib/types";
import {
  MOCK_ADVICE,
  MOCK_OVERVIEW,
  MOCK_POSITIONING,
  MOCK_RESUME_DIAGNOSIS,
  MOCK_STRENGTH,
} from "@/lib/mocks/report-mocks";
import { consumeBgSections, type BgSectionKey } from "@/lib/report-bg-runner";

// ===== 静态调度配置 =====

export type Trigger = "afterQuiz" | "afterQ2";

export const SECTION_CONFIG: {
  key: ReportSectionKey;
  endpoint: string;
  trigger: Trigger;
  label: string;
  fallback: unknown;
}[] = [
  // ---- 全部 5 个模块在 Q2 答完后同时启动（携带 Q1+Q2 答案，保证报告逻辑一致） ----
  { key: "overview",        endpoint: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/overview`,          trigger: "afterQ2", label: "绘制定位总览",   fallback: MOCK_OVERVIEW },
  { key: "positioning",     endpoint: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/positioning`,       trigger: "afterQ2", label: "推荐适配岗位",   fallback: MOCK_POSITIONING },
  { key: "resumeDiagnosis", endpoint: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/resume-diagnosis`,  trigger: "afterQ2", label: "诊断简历改进点", fallback: MOCK_RESUME_DIAGNOSIS },
  { key: "strength",        endpoint: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/strength`,          trigger: "afterQ2", label: "分析优势能力",   fallback: MOCK_STRENGTH },
  { key: "advice",          endpoint: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/advice`,            trigger: "afterQ2", label: "梳理行动建议",   fallback: MOCK_ADVICE },
];

export type SectionStatus = "pending" | "loading" | "completed" | "fallback" | "skipped";

export interface SectionProgress {
  key: ReportSectionKey;
  label: string;
  status: SectionStatus;
  error?: string;
}

// ===== 共享 fetch + 重试逻辑 =====

interface CallPayload {
  formData: JobFormData;
  quizAnswers?: QuizAnswer[];
  scoring?: ScoringResult;
  interviewQ1Q2?: { Q1?: string; Q2?: string };
}

async function callSection<T>(
  endpoint: string,
  payload: CallPayload,
  signal?: AbortSignal
): Promise<T | null> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    const err = new Error(j.error || `HTTP ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const json = (await res.json()) as { data?: T };
  return (json.data ?? null) as T | null;
}

function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number } | null)?.status;
  if (status === 429 || status === 529) return true;
  return /\b(429|529)\b|Token Plan|拥挤|rate.?limit|too many requests/i.test(msg);
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function fetchWithRetry<T>(
  endpoint: string,
  payload: CallPayload,
  retries: number,
  signal?: AbortSignal
): Promise<T | null> {
  let attempts = 0;
  let lastError: unknown;
  while (attempts <= retries) {
    try {
      return await callSection<T>(endpoint, payload, signal);
    } catch (e) {
      lastError = e;
      attempts++;
      if (attempts > retries) break;
      const isRL = isRateLimitError(e);
      const baseMs = isRL ? 2500 : 600;
      const jitter = Math.random() * (isRL ? 1800 : 400);
      const backoff = baseMs * Math.pow(1.8, attempts - 1) + jitter;
      await wait(Math.min(backoff, 12000));
    }
  }
  throw lastError;
}

// ===== 按 trigger 分组调度 =====

export interface StartPayload {
  formData: JobFormData;
  quizAnswers: QuizAnswer[];
  scoring: ScoringResult;
  interviewQ1Q2?: { Q1?: string; Q2?: string };
}

/** @deprecated no-op：所有模块已改为 afterQ2 触发，保留函数签名避免编译报错 */
export function startAfterQuiz(_payload: StartPayload): Map<ReportSectionKey, Promise<unknown>> {
  return new Map();
}

/** interview Q2 答完后调用：启动 strength / advice，携带 Q1+Q2 答案 */
export function startAfterQ2(payload: StartPayload): Map<ReportSectionKey, Promise<unknown>> {
  return startGroup("afterQ2", payload);
}

/** @deprecated 已废弃，由 startAfterQuiz + startAfterQ2 替代，保留为 no-op */
export function startAfterQ3(_payload: StartPayload): Map<ReportSectionKey, Promise<unknown>> {
  return new Map();
}

function startGroup(
  trigger: Trigger,
  payload: StartPayload
): Map<ReportSectionKey, Promise<unknown>> {
  const promises = new Map<ReportSectionKey, Promise<unknown>>();
  const callPayload: CallPayload = {
    formData: payload.formData,
    quizAnswers: payload.quizAnswers,
    scoring: payload.scoring,
    interviewQ1Q2: payload.interviewQ1Q2,
  };
  for (const section of SECTION_CONFIG) {
    if (section.trigger !== trigger) continue;
    // 简历快诊：无简历或简历过短直接跳过
    if (section.key === "resumeDiagnosis") {
      const r = payload.formData.resumeText;
      if (!r || r.length < 50) {
        promises.set(section.key, Promise.resolve(null));
        continue;
      }
    }
    const p = fetchWithRetry<unknown>(section.endpoint, callPayload, 1).catch((err) => {
      throw err;
    });
    p.catch(() => {}); // 防 unhandled rejection 警告
    promises.set(section.key, p);
  }
  return promises;
}

// ===== loading 页消费层 =====

export interface ConsumeOptions {
  onProgress?: (progress: SectionProgress[]) => void;
  useMockOnly?: boolean;
  /** 内存 promise miss 时回退现场 fetch 用的 payload */
  fallbackPayload?: StartPayload;
  /** Q2 答完后触发的章节需要 Q1Q2 摘要 */
  interviewQ1Q2?: { Q1?: string; Q2?: string };
}

/**
 * loading 页 mount 时调用：消费全部 5 个 promise → 失败章节 fallback 到 mock → 装配 ReportData。
 */
export async function consumeAll(
  formData: JobFormData,
  quizAnswers: QuizAnswer[],
  scoring: ScoringResult,
  options: ConsumeOptions = {}
): Promise<ReportData> {
  const bgPrefetched = consumeBgSections(formData, quizAnswers);

  const progress: SectionProgress[] = SECTION_CONFIG.map((s) => ({
    key: s.key,
    label: s.label,
    status: "pending",
  }));
  const update = () => options.onProgress?.([...progress]);
  update();

  const callPayloadBase: CallPayload = {
    formData,
    quizAnswers,
    scoring,
    interviewQ1Q2: options.interviewQ1Q2,
  };

  const tasks = SECTION_CONFIG.map((section, idx) => async () => {
    if (
      section.key === "resumeDiagnosis" &&
      (!formData.resumeText || formData.resumeText.length < 50)
    ) {
      progress[idx].status = "skipped";
      update();
      return { key: section.key, data: null };
    }

    progress[idx].status = "loading";
    update();

    // 优先消费 bg-runner 的内存 promise
    const bgPromise = bgPrefetched?.get(section.key as BgSectionKey);
    if (bgPromise !== undefined) {
      try {
        const data = await bgPromise;
        progress[idx].status = "completed";
        update();
        return { key: section.key, data };
      } catch (bgErr) {
        console.warn(`[report] bg-runner promise failed for ${section.key}, retrying:`, bgErr);
      }
    }

    // 现场 fetch（内存 promise miss 或刚才失败）
    try {
      if (options.useMockOnly) throw new Error("forced mock");
      const data = await fetchWithRetry<unknown>(section.endpoint, callPayloadBase, 1);
      progress[idx].status = "completed";
      update();
      return { key: section.key, data };
    } catch (e) {
      console.warn(`[report] ${section.key} failed, using mock:`, e);
      progress[idx].status = "fallback";
      progress[idx].error = e instanceof Error ? e.message : String(e);
      update();
      return { key: section.key, data: section.fallback };
    }
  });

  // 5 章节并发消费（promise 已提前在后台发起，这里只是 await）
  const results = await Promise.all(tasks.map((t) => t()));
  const map = new Map<ReportSectionKey, unknown>();
  for (const r of results) map.set(r.key, r.data);

  const meta: ReportMeta = {
    generatedAt: new Date().toISOString(),
    formData,
    scoring,
    hasResume: Boolean(formData.resumeText && formData.resumeText.length > 50),
    interviewQ1Q2: options.interviewQ1Q2 ?? {},
  };

  return {
    meta,
    overview: map.get("overview") as Overview,
    strength: map.get("strength") as Strength,
    positioning: map.get("positioning") as Positioning,
    resumeDiagnosis: map.get("resumeDiagnosis") as ResumeDiagnosis | null,
    advice: map.get("advice") as Advice,
  };
}
