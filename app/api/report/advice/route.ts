import { NextRequest, NextResponse } from "next/server";
import {
  APPLICANT_BASELINE,
  buildBaseContext,
  callWithFallback,
} from "@/lib/report-shared";
import { MOCK_ADVICE } from "@/lib/mocks/report-mocks";
import type { Advice, JobFormData, ScoringResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---- 内容校验 ----
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^\.{2,}$/,
  /^<[^>]*>$/,
  /^x{2,}$/i,
  /^示例/,
  /^请填/,
];

const VAGUE_WHOLE_STRINGS: RegExp[] = [
  /^多投简历$/,
  /^提升能力$/,
  /^准备面试$/,
  /^好好学习$/,
  /^加油$/,
];

function isBadString(s: unknown, minLen = 2): boolean {
  if (typeof s !== "string") return true;
  const t = s.trim();
  if (t.length < minLen) return true;
  if (PLACEHOLDER_PATTERNS.some((re) => re.test(t))) return true;
  if (VAGUE_WHOLE_STRINGS.some((re) => re.test(t))) return true;
  return false;
}

function validateAdvice(d: Advice): string | null {
  if (!d || typeof d !== "object") return "advice 根对象缺失";
  if (!Array.isArray(d.topThree) || d.topThree.length < 3)
    return "topThree 必须 3 条";
  for (const item of d.topThree) {
    if (!item || typeof item !== "object") return "topThree 元素非对象";
    if (isBadString(item.title, 4)) return "topThree.title 缺失/过短";
    if (isBadString(item.detail, 20)) return "topThree.detail 缺失/过短";
    if (isBadString(item.deadline, 2)) return "topThree.deadline 缺失";
  }
  return null;
}

const SYSTEM_PROMPT = `你是黄浦区职业咨询师。基于用户画像给出最务实、最重要的下一步行动。

${APPLICANT_BASELINE}

【任务】输出 JSON：topThree — 用户下一步最重要的三件事，按优先级从高到低排列。

每件事包含：
- title：4-10 字动作标题（如"重写简历核心经历"、"准备 90 秒自我介绍"）
- detail：50-100 字具体说明，必须包含「做什么 + 怎么做 + 做到什么程度」，不泛泛而谈
- deadline：建议完成时间锚点（如"本周内"、"两周内"、"一个月内"）

【硬约束】
- 严格输出 3 条，不多不少
- 每条必须是该用户当前阶段最值得花时间做的事，不是万能模板
- detail 必须含具体动作 + 可验证产出：
  - 反例："多投简历"、"提升能力"、"注意形象"（空话）
  - 正例："把简历中的'负责招聘'改为'负责 3 个部门共 12 人的招聘，到岗周期从 45 天降到 28 天'"
- deadline 按实际可操作的时间安排，不要写"尽快"
- recent_grad：重点是「找到第一份工作的关键步骤」
- young_unemployed：重点是「快速匹配合适岗位」
- general_unemployed：重点是「用过往经历定向投递」
- 不指名具体公司/培训机构
- 不出现 MBTI / 大五 / 霍兰德等专有名词

输出 JSON schema:
{
  "topThree": [{ "title": "string", "detail": "string", "deadline": "string" }]
}`;

function buildScoringSummary(scoring: ScoringResult): string {
  const fourDim = scoring.fourDim
    .map((d) => `- ${d.name}：${d.score} 分`)
    .join("\n");
  const ability = scoring.ability
    .map((a) => `- ${a.name}：${a.score} 分`)
    .join("\n");
  return [
    "性格四维评分：",
    fourDim,
    "",
    "能力六维评分：",
    ability,
  ].join("\n");
}

/** 如果 LLM 输出不足 3 条，用 mock 补齐 */
function patchAdvice(d: Advice): Advice {
  const filtered = Array.isArray(d.topThree)
    ? d.topThree.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          !isBadString(item.title, 4) &&
          !isBadString(item.detail, 20) &&
          !isBadString(item.deadline, 2)
      )
    : [];

  // 补齐到 3 条
  let i = 0;
  while (filtered.length < 3 && i < MOCK_ADVICE.topThree.length) {
    const cand = MOCK_ADVICE.topThree[i++];
    if (!filtered.some((x) => x.title === cand.title)) {
      filtered.push(cand);
    }
  }

  return { topThree: filtered.slice(0, 3) };
}

export async function POST(req: NextRequest) {
  if (process.env.E2E_MOCK_MODE === "true") {
    return NextResponse.json({ data: MOCK_ADVICE, source: "mock" as const });
  }

  let formData: JobFormData | undefined;
  let scoring: ScoringResult | undefined;

  try {
    const body = await req.json();
    formData = body?.formData as JobFormData | undefined;
    scoring = body?.scoring as ScoringResult | undefined;

    if (!formData?.identity) {
      return NextResponse.json(
        {
          data: MOCK_ADVICE,
          source: "mock" as const,
          errorMessage: "缺少表单关键字段（identity）",
        },
        { status: 200 }
      );
    }
    if (
      !scoring?.fourDim ||
      !Array.isArray(scoring.fourDim) ||
      scoring.fourDim.length !== 4
    ) {
      return NextResponse.json(
        {
          data: MOCK_ADVICE,
          source: "mock" as const,
          errorMessage: "scoring.fourDim 必须为 4 项",
        },
        { status: 200 }
      );
    }
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : "请求体解析失败";
    return NextResponse.json(
      {
        data: MOCK_ADVICE,
        source: "mock" as const,
        errorMessage: msg,
      },
      { status: 200 }
    );
  }

  const baseCtx = buildBaseContext(formData);
  const userPrompt = [
    `请严格按约定 JSON 输出"行动计划"章节 — 该用户下一步最重要的三件事。`,
    "",
    baseCtx,
    "",
    buildScoringSummary(scoring),
    "",
    `提醒：严格 3 条，每条必须含具体动作 + 可验证产出 + 时间锚点。`,
  ].join("\n");

  try {
    const data = await callWithFallback<Advice>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1200,
      temperature: 0.6,
      validator: validateAdvice,
      context: "advice",
    });
    const patched = patchAdvice(data);
    return NextResponse.json(
      { data: patched, source: "deepseek" as const },
      { status: 200 }
    );
  } catch (err) {
    console.error("[advice] both LLM links failed, fallback to mock:", err);
    const message =
      err instanceof AggregateError
        ? err.errors
            .map((e) => (e instanceof Error ? e.message : String(e)))
            .join(" | ")
        : err instanceof Error
          ? err.message
          : "行动计划章节生成失败";

    return NextResponse.json(
      {
        data: MOCK_ADVICE,
        source: "mock" as const,
        errorMessage: message,
      },
      { status: 200 }
    );
  }
}
