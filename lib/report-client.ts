/**
 * Report 章节前端调度器（5 模块版 · 单请求模式）
 * ———————————————
 * 触发时序：
 *   - interview Q2 答完 → bg-runner.startAfterQ2 → clientFireGenerate
 *     → 单次 POST /api/report/generate（内部顺序生成全部 5 模块，前后逻辑一致）
 *   - loading 页 mount → consumeAll → 消费 bg-runner 的 promise 或现场 fetch
 *   - Q3/Q4 答案不入报告，仅作访谈体验缓冲
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
import { consumeBgGeneratePromise } from "@/lib/report-bg-runner";

// ===== 类型 =====

export type Trigger = "afterQuiz" | "afterQ2";

export type SectionStatus = "pending" | "loading" | "completed" | "fallback" | "skipped";

export interface SectionProgress {
  key: ReportSectionKey;
  label: string;
  status: SectionStatus;
  error?: string;
}

export interface StartPayload {
  formData: JobFormData;
  quizAnswers: QuizAnswer[];
  scoring: ScoringResult;
  interviewQ1Q2?: { Q1?: string; Q2?: string };
}

// generate 端点返回的数据结构（对应 route 的 data 字段）
interface GenerateSections {
  overview: Overview;
  strength: Strength;
  positioning: Positioning;
  resumeDiagnosis: ResumeDiagnosis | null;
  advice: Advice;
}

interface CallPayload {
  formData: JobFormData;
  quizAnswers?: QuizAnswer[];
  scoring?: ScoringResult;
  interviewQ1Q2?: { Q1?: string; Q2?: string };
}

// ===== 端点配置 =====

const GENERATE_ENDPOINT = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/generate`;

// 5 个 section 的标签（loading 页展示用）
const SECTION_LABEL: Record<ReportSectionKey, string> = {
  overview: "绘制定位总览",
  strength: "分析优势能力",
  positioning: "推荐适配岗位",
  resumeDiagnosis: "诊断简历改进点",
  advice: "梳理行动建议",
};

const SECTION_KEYS: ReportSectionKey[] = [
  "overview",
  "strength",
  "positioning",
  "resumeDiagnosis",
  "advice",
];

// ===== 网络层 =====

async function callGenerate(
  payload: CallPayload,
  signal?: AbortSignal
): Promise<GenerateSections | null> {
  const res = await fetch(GENERATE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: GenerateSections };
  return json.data ?? null;
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

async function callGenerateWithRetry(
  payload: CallPayload,
  retries = 1
): Promise<GenerateSections | null> {
  let attempts = 0;
  let lastError: unknown;
  while (attempts <= retries) {
    try {
      return await callGenerate(payload);
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

// ===== bg-runner 对接接口 =====

/**
 * bg-runner 调用此函数触发单次 generate 请求。
 * 返回 Promise<GenerateSections | null>，bg-runner 存储后在 consumeAll 里消费。
 */
export function clientFireGenerate(payload: StartPayload): Promise<unknown> {
  const callPayload: CallPayload = {
    formData: payload.formData,
    quizAnswers: payload.quizAnswers,
    scoring: payload.scoring,
    interviewQ1Q2: payload.interviewQ1Q2,
  };
  return callGenerateWithRetry(callPayload, 1);
}

/** @deprecated no-op：保留函数签名供历史调用点 import 不破 */
export function startAfterQuiz(_: StartPayload): Map<ReportSectionKey, Promise<unknown>> {
  return new Map();
}

/** @deprecated bg-runner 现在直接调 clientFireGenerate；此函数作为 no-op 保留 */
export function startAfterQ2(_: StartPayload): Map<ReportSectionKey, Promise<unknown>> {
  return new Map();
}

/** @deprecated no-op */
export function startAfterQ3(_: StartPayload): Map<ReportSectionKey, Promise<unknown>> {
  return new Map();
}

// ===== ConsumeOptions =====

export interface ConsumeOptions {
  onProgress?: (progress: SectionProgress[]) => void;
  useMockOnly?: boolean;
  fallbackPayload?: StartPayload;
  interviewQ1Q2?: { Q1?: string; Q2?: string };
}

// ===== 核心：consumeAll =====

/**
 * loading 页 mount 时调用：
 * 1. 优先消费 bg-runner 后台已触发的 promise（Q2 → Q3/Q4 期间预热）
 * 2. 内存 miss → 现场调 /api/report/generate
 * 3. 失败 → 全部 fallback 到 mock
 * 4. 组装并返回完整 ReportData
 *
 * 进度回调：
 * - 开始：所有 section "loading"（resumeDiagnosis 无简历时直接 "skipped"）
 * - 结束：成功则全部 "completed"，失败则全部 "fallback"
 */
export async function consumeAll(
  formData: JobFormData,
  quizAnswers: QuizAnswer[],
  scoring: ScoringResult,
  options: ConsumeOptions = {}
): Promise<ReportData> {
  const hasResume = Boolean(formData.resumeText && formData.resumeText.length >= 50);

  // ---- 初始进度：全部 loading ----
  const loadingProgress: SectionProgress[] = SECTION_KEYS.map((key) => ({
    key,
    label: SECTION_LABEL[key],
    status: key === "resumeDiagnosis" && !hasResume ? "skipped" : "loading",
  }));
  options.onProgress?.([...loadingProgress]);

  const callPayload: CallPayload = {
    formData,
    quizAnswers,
    scoring,
    interviewQ1Q2: options.interviewQ1Q2,
  };

  let sections: GenerateSections | null = null;
  let fetchError: unknown = null;

  // ---- 1. 尝试消费 bg-runner 后台 promise ----
  const bgPromise = consumeBgGeneratePromise(
    formData,
    quizAnswers,
    options.interviewQ1Q2 ?? {}
  );
  if (bgPromise !== null) {
    try {
      sections = (await bgPromise) as GenerateSections | null;
    } catch (e) {
      console.warn("[consumeAll] bg promise failed, will retry fresh:", e);
      fetchError = e;
    }
  }

  // ---- 2. 内存 miss 或 bg 失败 → 现场 fetch ----
  if (!sections) {
    if (options.useMockOnly) {
      console.info("[consumeAll] useMockOnly=true, skipping fetch");
    } else {
      try {
        sections = await callGenerateWithRetry(callPayload, 1);
      } catch (e) {
        fetchError = e;
        console.warn("[consumeAll] fresh generate fetch failed, all-mock fallback:", e);
      }
    }
  }

  // ---- 3. 提取各模块，失败的单独 mock 兜底 ----
  const overview: Overview = sections?.overview ?? {
    ...MOCK_OVERVIEW,
    fourDimRadar: scoring.fourDim.map((d, i) => ({
      name: d.name,
      score: d.score,
      ...(MOCK_OVERVIEW.fourDimRadar[i]?.conclusion
        ? { conclusion: MOCK_OVERVIEW.fourDimRadar[i].conclusion }
        : {}),
    })),
  };
  const strength: Strength = sections?.strength ?? {
    ...MOCK_STRENGTH,
    abilityRadar: scoring.ability.map((a) => ({ name: a.name, score: a.score })),
  };
  const positioning: Positioning = sections?.positioning ?? MOCK_POSITIONING;
  const resumeDiagnosis: ResumeDiagnosis | null = !hasResume
    ? null
    : (sections?.resumeDiagnosis ?? MOCK_RESUME_DIAGNOSIS);
  const advice: Advice = sections?.advice ?? MOCK_ADVICE;

  // ---- 4. 最终进度 ----
  const finalStatus: SectionStatus = sections ? "completed" : "fallback";
  const finalProgress: SectionProgress[] = SECTION_KEYS.map((key) => ({
    key,
    label: SECTION_LABEL[key],
    status: key === "resumeDiagnosis" && !hasResume
      ? "skipped"
      : finalStatus,
    ...(finalStatus === "fallback" && fetchError
      ? { error: fetchError instanceof Error ? fetchError.message : String(fetchError) }
      : {}),
  }));
  options.onProgress?.([...finalProgress]);

  // ---- 5. 组装 ReportData ----
  const meta: ReportMeta = {
    generatedAt: new Date().toISOString(),
    formData,
    scoring,
    hasResume,
    interviewQ1Q2: options.interviewQ1Q2 ?? {},
  };

  return { meta, overview, strength, positioning, resumeDiagnosis, advice };
}
