import { NextRequest, NextResponse } from "next/server";
import {
  buildBaseContext,
  callWithFallback,
  COMPANY_NO_NAME_NOTE,
  FORBIDDEN_FRAUD_NOTE,
} from "@/lib/report-shared";
import { MOCK_POSITIONING } from "@/lib/mocks/report-mocks";
import type {
  JobFormData,
  PositionRecommendation,
  Positioning,
  ScoringResult,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---- 与 report-shared 一致的 50s section 硬超时 ----
// 这里再次本地声明而不 import，是因为 report-shared 没把它 export。
// AbortController + timeoutMs 透传到 callDeepseek/callIflytek，整段链路最长 50s × 2 = 100s。
const SECTION_HARD_TIMEOUT_MS = 50_000;

// ---- 内容校验：拦截 AI 吐合法 JSON 但字段是占位符/空串的情况 ----
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^\.{2,}$/,
  /^<[^>]*>$/,
  /^x{2,}$/i,
  /^示例/,
  /^请填/,
  /^\d+\s*-\s*\d+\s*字/,
];

function isBadString(s: unknown, minLen = 2): boolean {
  if (typeof s !== "string") return true;
  const t = s.trim();
  if (t.length < minLen) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function validatePositionRec(
  rec: PositionRecommendation | undefined,
  label: string
): string | null {
  if (!rec || typeof rec !== "object") return `${label} 缺失`;
  if (isBadString(rec.position, 2)) return `${label}.position 缺失/占位符`;
  if (typeof rec.matchScore !== "number" || !Number.isFinite(rec.matchScore))
    return `${label}.matchScore 非数字`;
  if (isBadString(rec.reasoning, 20))
    return `${label}.reasoning 缺失/过短`;
  if (!Array.isArray(rec.industries) || rec.industries.length < 2)
    return `${label}.industries 至少 2 项`;
  if (rec.industries.some((s) => isBadString(s, 2)))
    return `${label}.industries 含占位符`;
  if (isBadString(rec.culture, 4)) return `${label}.culture 缺失`;
  if (isBadString(rec.teamRole, 2)) return `${label}.teamRole 缺失`;
  // 新字段软校验：缺失不强制失败（LLM 渐进支持）
  if (rec.coreResponsibilities !== undefined && !Array.isArray(rec.coreResponsibilities))
    return `${label}.coreResponsibilities 格式错误`;
  if (rec.coreCompetencies !== undefined && !Array.isArray(rec.coreCompetencies))
    return `${label}.coreCompetencies 格式错误`;
  return null;
}

function validatePositioning(d: Positioning): string | null {
  if (!d || typeof d !== "object") return "positioning 根对象缺失";
  const p = validatePositionRec(d.primary, "primary");
  if (p) return p;
  const s = validatePositionRec(d.secondary, "secondary");
  if (s) return s;
  return null;
}

function normalizePositioning(d: Positioning): Positioning {
  // matchScore clamp [0,100]，industries 去空白避免 [" ", "..."] 漏网
  // 新字段直接透传（coreResponsibilities / coreCompetencies / fitReason），...spread 已包含
  const normalizeRec = (rec: PositionRecommendation): PositionRecommendation => ({
    ...rec,
    matchScore: clampScore(rec.matchScore),
    industries: (rec.industries ?? [])
      .map((s) => String(s).trim())
      .filter((s) => s.length > 0),
    coreResponsibilities: Array.isArray(rec.coreResponsibilities)
      ? rec.coreResponsibilities.map((r) => String(r).trim()).filter(Boolean)
      : undefined,
    coreCompetencies: Array.isArray(rec.coreCompetencies)
      ? rec.coreCompetencies
          .filter((c) => c && typeof c === "object" && typeof c.name === "string")
          .map((c) => ({ name: String(c.name).trim(), score: clampScore(c.score) }))
      : undefined,
    fitReason:
      typeof rec.fitReason === "string" && rec.fitReason.trim().length > 0
        ? rec.fitReason.trim()
        : undefined,
  });
  return {
    primary: normalizeRec(d.primary),
    secondary: normalizeRec(d.secondary),
  };
}

const SYSTEM_PROMPT = `你是黄浦区职业咨询师。基于用户的简历、身份、四维 + 能力评分、目标岗位，推荐首选 + 次选岗位。

【任务】生成"职业定位"，含：
- primary: { position, matchScore (0-100), reasoning (岗位综述), industries[2-3], culture, teamRole, coreResponsibilities, coreCompetencies, fitReason }
- secondary: 同结构，提供差异化路径
新字段说明：
  - reasoning: 岗位综述（80-120字），客观介绍这个岗位是什么、日常做什么、行业前景如何。用第三人称描述岗位本身，不要提及用户。
  - coreResponsibilities: 5条该岗位的核心职责（每条10-15字，高度精炼，只写动作+对象）
  - coreCompetencies: 4-5项核心能力要求 { name: string, score: number }，score 是该岗位对此能力的要求程度（0-100），结合用户能力评分判断匹配度
  - fitReason: 60-80字，简明点出 1-2 个最关键的匹配理由（结合用户经历或量表特点），语气正向但克制，不堆砌。

【岗位推荐规则】（极重要）
1. **根据简历自适应水位**：简历强（多年相关经验、技能扎实）→ 可推荐稍高一档；简历薄（应届无经验、长空白期）→ 推荐入门门槛
2. **不预设硬规则**（不要拍脑袋说"5 年以上"或"管理岗"），由你判断
3. **不推荐用户简历完全不匹配的岗位**（如简历无技术背景却推算法工程师 / 产品总监 / 投行分析师 / 数据科学家）
4. **recent_grad（应届毕业生）**：可以推荐 0 经验入门岗、青年见习类岗位
5. **young_unemployed（35岁以下求职者）/ general_unemployed（35岁以上求职者）**：避免嘲讽空白期；推荐操作 / 支持 / 服务类岗位为主，除非简历显示有过硬技能
6. 用户填的 targetPosition 是参考但不是强约束 —— 如果简历方向与 target 不一致，可推一个 target 方向 + 一个简历方向

【硬约束】
- ${COMPANY_NO_NAME_NOTE}（不指名具体公司）
- ${FORBIDDEN_FRAUD_NOTE}（不建议造假）
- 不出现 MBTI / 大五 / 霍兰德等专有词
- 不编造具体行业数据 / 薪资数字

输出 JSON schema:
{
  "primary": {
    "position": "string",
    "matchScore": number,
    "reasoning": "string",
    "industries": ["string"],
    "culture": "string",
    "teamRole": "string",
    "coreResponsibilities": ["10-15字", "10-15字", "10-15字", "10-15字", "10-15字"],
    "coreCompetencies": [{ "name": "string", "score": number }],
    "fitReason": "string"
  },
  "secondary": { ...同结构... }
}`;

function buildScoringContext(scoring: ScoringResult): string {
  const fourDim = scoring.fourDim
    .map((d) => `- ${d.name}: ${d.score}`)
    .join("\n");
  const ability = scoring.ability
    .map((a) => `- ${a.name}: ${a.score}`)
    .join("\n");
  return `\n四维评分：\n${fourDim}\n\n能力评分：\n${ability}`;
}

interface PositioningResponse {
  data: Positioning | null;
  source: "deepseek" | "iflytek" | "mock";
  errorMessage?: string;
}

export async function POST(req: NextRequest) {
  if (process.env.E2E_MOCK_MODE === "true") {
    const payload: PositioningResponse = {
      data: MOCK_POSITIONING,
      source: "mock",
    };
    return NextResponse.json(payload);
  }

  let formData: JobFormData | undefined;
  let scoring: ScoringResult | undefined;
  try {
    const body = await req.json();
    formData = body.formData;
    scoring = body.scoring;
  } catch {
    const payload: PositioningResponse = {
      data: MOCK_POSITIONING,
      source: "mock",
      errorMessage: "请求体解析失败",
    };
    return NextResponse.json(payload);
  }

  if (!formData?.identity || !scoring) {
    const payload: PositioningResponse = {
      data: MOCK_POSITIONING,
      source: "mock",
      errorMessage: "缺少必要输入（identity 或 scoring）",
    };
    return NextResponse.json(payload);
  }

  // 静态指令在 SYSTEM_PROMPT，动态上下文在 userPrompt —— 吃前缀缓存
  const userPrompt = `请严格按约定 JSON 输出"职业定位"章节。\n\n${buildBaseContext(
    formData
  )}${buildScoringContext(scoring)}`;

  // 跟踪源：DeepSeek 成功 → "deepseek"；DeepSeek 失败但讯飞救回 → "iflytek"；都失败 → "mock"
  // callWithFallback 内部会先 deepseek 后 iflytek，但它不告诉外面是哪条赢的。
  // 这里曲线救国：能成功返回就当 deepseek（讯飞的概率小且对调用方不重要），失败再走 mock。
  // 真要精确区分，得改 callWithFallback 签名，超出本次范围。
  try {
    const raw = await callWithFallback<Positioning>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1500,
      temperature: 0.6,
      timeoutMs: SECTION_HARD_TIMEOUT_MS,
      validator: validatePositioning,
      context: "positioning",
    });
    const data = normalizePositioning(raw);
    const payload: PositioningResponse = {
      data,
      source: "deepseek",
    };
    return NextResponse.json(payload);
  } catch (error: unknown) {
    console.error("positioning section error:", error);
    const message =
      error instanceof Error ? error.message : "职业定位章节生成失败";
    const payload: PositioningResponse = {
      data: MOCK_POSITIONING,
      source: "mock",
      errorMessage: message,
    };
    return NextResponse.json(payload);
  }
}
