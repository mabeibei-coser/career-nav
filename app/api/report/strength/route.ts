import { NextRequest, NextResponse } from "next/server";
import {
  APPLICANT_BASELINE,
  buildBaseContext,
  callWithFallback,
} from "@/lib/report-shared";
import { MOCK_STRENGTH } from "@/lib/mocks/report-mocks";
import type { JobFormData, ScoringResult, Strength } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// 注：`JSON_ONLY_PREFIX` 与 `SECTION_HARD_TIMEOUT_MS` 在 report-shared.ts 内部
// 由 callDeepseekJson / callIflytekJson 自动注入与默认应用——本路由无需手动拼接。

// ---- 内容校验：拦截 AI 吐合法 JSON 但字段是占位符/空串的情况 ----
// 命中则返回错误字符串 → callWithFallback 切讯飞重试 → 仍失败外层 catch fallback 到 MOCK_STRENGTH
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^\.{2,}$/, //         "..."、".."
  /^<[^>]*>$/, //        "<字段描述>"
  /^x{2,}$/i, //         "xxx"、"XX"
  /^示例/, //             "示例..."
  /^请填/, //             "请填..."
  /^\d+\s*-\s*\d+\s*字/, // "60-80 字"（schema 描述被原样输出）
];

function isBadString(s: unknown, minLen = 2): boolean {
  if (typeof s !== "string") return true;
  const t = s.trim();
  if (t.length < minLen) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

const ABILITY_RADAR_NAMES = [
  "沟通表达",
  "协作意识",
  "执行落地",
  "学习能力",
  "信息处理",
  "压力适应",
];

function validateStrength(d: Strength): string | null {
  if (!d || typeof d !== "object") return "strength 根对象缺失";
  if (!Array.isArray(d.abilityRadar) || d.abilityRadar.length !== 6) {
    return "abilityRadar 必须 6 项";
  }
  if (!Array.isArray(d.strengths) || d.strengths.length < 3) {
    return "strengths 至少 3 条";
  }
  for (const s of d.strengths) {
    if (!s || isBadString(s.title) || isBadString(s.detail, 20)) {
      return "strengths 条目缺失/占位符";
    }
  }
  if (!Array.isArray(d.growth) || d.growth.length < 2) {
    return "growth 至少 2 条";
  }
  for (const g of d.growth) {
    if (!g || isBadString(g.title) || isBadString(g.detail, 20)) {
      return "growth 条目缺失/占位符";
    }
  }
  return null;
}

const SYSTEM_PROMPT = `你是黄浦区职业咨询师。基于用户的「能力评分」+「简历内容」分析优势 + 待提升项。

${APPLICANT_BASELINE}

【任务】生成"优势发现"模块，含：
1. abilityRadar: 6 项能力得分 { name, score }。name 严格按「沟通表达 / 协作意识 / 执行落地 / 学习能力 / 信息处理 / 压力适应」顺序，score 照搬入参 scoring.ability（不重算！）
2. strengths: 3 条优势 { title (8-12 字), detail (60-80 字 结合简历给具体证据) }
3. growth: 2 条待提升 { title, detail }，**避免审判语气**，写"可以多做 X"而非"你 Y 不够"

【硬约束】
- abilityRadar score 照搬入参（后端会再覆写一次兜底）
- strengths 要从简历找具体证据（如某项工作经历、技能描述）；如果简历空缺，从 ability 高分维度泛说
- 极端值平滑：ability < 30 的能力在 growth 区出现时，措辞用"还在打基础"，不出现具体数字
- 不出现 MBTI / 大五 / 霍兰德等专有名词
- 身份适配：recent_grad（离校未就业）重点说"潜力"；young_unemployed / general_unemployed 重点说"已积累的经验"，不嘲讽空白期

输出 JSON: { "abilityRadar": [...], "strengths": [...], "growth": [...] }`;

function buildAbilityScoreLines(scoring: ScoringResult): string {
  // 把入参能力分按固定 6 项顺序整理给模型，避免它自己排序错乱
  const map = new Map(scoring.ability.map((a) => [a.name, a.score]));
  return ABILITY_RADAR_NAMES.map(
    (name) => `- ${name}: ${map.get(name) ?? "未评分"}`
  ).join("\n");
}

export async function POST(req: NextRequest) {
  // E2E mock 短路：跑测试时不烧 LLM 额度
  if (process.env.E2E_MOCK_MODE === "true") {
    return NextResponse.json({ data: MOCK_STRENGTH, source: "mock" });
  }

  let scoring: ScoringResult | undefined;
  try {
    const body = await req.json();
    const { formData, scoring: scoringInput, resumeText } = body as {
      formData: JobFormData;
      scoring: ScoringResult;
      resumeText?: string;
    };
    scoring = scoringInput;

    if (!formData?.identity) {
      // 入参不全也不 5xx，直接 mock 兜底
      return NextResponse.json({
        data: MOCK_STRENGTH,
        source: "mock",
        errorMessage: "缺少意向信息（formData.identity）",
      });
    }
    if (
      !scoring ||
      !Array.isArray(scoring.ability) ||
      scoring.ability.length !== 6
    ) {
      return NextResponse.json({
        data: MOCK_STRENGTH,
        source: "mock",
        errorMessage: "scoring.ability 缺失或长度不为 6",
      });
    }

    // 简历文本：优先使用 body.resumeText，回退 formData.resumeText；都空就显式声明
    const resumeForCtx =
      resumeText && resumeText.trim().length > 0
        ? resumeText
        : formData.resumeText;
    const ctxFormData: JobFormData = {
      ...formData,
      resumeText: resumeForCtx,
    };
    const resumeFlag = resumeForCtx?.trim()
      ? "（简历已上传，请从简历内容找具体证据）"
      : "（用户未上传简历，请基于能力评分高分维度泛化输出 strengths）";

    // 静态指令前置，buildBaseContext 的动态内容后置 —— 吃 DeepSeek 自动前缀缓存
    const userPrompt = `请严格按约定 JSON 输出"优势发现"章节。${resumeFlag}

${buildBaseContext(ctxFormData)}

【入参 · scoring.ability（abilityRadar 必须照搬这 6 个分数）】
${buildAbilityScoreLines(scoring)}`;

    let source: "deepseek" | "iflytek" = "deepseek";
    let data: Strength;
    try {
      data = await callWithFallback<Strength>({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        maxTokens: 1500,
        temperature: 0.6,
        validator: validateStrength,
        context: "strength",
      });
    } catch (llmErr) {
      // 双链路都失败：兜底 mock，但仍返回 200
      const message =
        llmErr instanceof Error ? llmErr.message : "LLM 双链路失败";
      console.error("[strength] LLM 双链路失败，fallback mock:", message);
      // mock 的 abilityRadar 也按入参覆写，保证前端雷达图与用户实际评分一致
      const mocked: Strength = {
        ...MOCK_STRENGTH,
        abilityRadar: scoring.ability.map((a) => ({
          name: a.name,
          score: a.score,
        })),
      };
      return NextResponse.json({
        data: mocked,
        source: "mock",
        errorMessage: message,
      });
    }

    // 如果 callWithFallback 第一路失败但第二路成功，无法直接区分；保守标记 deepseek
    // （source 精细化需 callWithFallback 暴露 caller 字段，超出本节范围）
    source = "deepseek";

    // 强制覆写 abilityRadar：模型偶尔会重算/换序/漏项，以入参为唯一真相
    data.abilityRadar = scoring.ability.map((a) => ({
      name: a.name,
      score: a.score,
    }));

    return NextResponse.json({ data, source });
  } catch (error: unknown) {
    // 任何意外（JSON 解析失败、body 异常等）一律不 5xx，mock 兜底
    const message =
      error instanceof Error ? error.message : "优势发现章节生成失败";
    console.error("[strength] 顶层异常，fallback mock:", message);
    const mocked: Strength = scoring
      ? {
          ...MOCK_STRENGTH,
          abilityRadar: scoring.ability.map((a) => ({
            name: a.name,
            score: a.score,
          })),
        }
      : MOCK_STRENGTH;
    return NextResponse.json({
      data: mocked,
      source: "mock",
      errorMessage: message,
    });
  }
}
