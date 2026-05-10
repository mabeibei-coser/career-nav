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

// ---- 内容校验：拦截 AI 吐合法 JSON 但字段是占位符/空串/泛泛而谈的情况 ----
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^\.{2,}$/,
  /^<[^>]*>$/,
  /^x{2,}$/i,
  /^示例/,
  /^请填/,
];

// 泛泛而谈黑名单：只有这几个词、没有具体动作 / 时间 / 产出
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
  if (!Array.isArray(d.applyDirection) || d.applyDirection.length < 3)
    return "applyDirection 至少 3 条";
  for (const a of d.applyDirection) {
    if (!a || typeof a !== "object")
      return "applyDirection 元素非对象";
    if (isBadString(a.channel, 3))
      return "applyDirection.channel 缺失/占位符";
    if (isBadString(a.tip, 15))
      return "applyDirection.tip 过短或泛泛而谈";
  }
  if (!Array.isArray(d.skillUp) || d.skillUp.length < 2)
    return "skillUp 至少 2 条";
  for (const s of d.skillUp) {
    if (!s || typeof s !== "object") return "skillUp 元素非对象";
    if (isBadString(s.skill, 2)) return "skillUp.skill 缺失";
    if (isBadString(s.resource, 4)) return "skillUp.resource 缺失";
    if (isBadString(s.duration, 2)) return "skillUp.duration 缺失";
  }
  if (!Array.isArray(d.interviewTips) || d.interviewTips.length < 3)
    return "interviewTips 至少 3 条";
  for (const t of d.interviewTips) {
    if (isBadString(t, 15))
      return "interviewTips 单条过短或泛泛而谈";
  }
  return null;
}

const SYSTEM_PROMPT = `你是黄浦区职业咨询师。给用户具体的行动建议（不是泛泛而谈）。

${APPLICANT_BASELINE}

【任务】输出 Advice JSON：
- applyDirection: 3 条 { channel, tip }
  - channel = 投递渠道（如"上海公共招聘网"、"目标行业的连锁机构现场招聘"、"行业垂直 BBS / 论坛"），不指名具体公司
  - tip = 具体可执行的动作（如"本周筛选 3-5 个目标岗位投递，先投不要纠结"）
- skillUp: 2-4 条 { skill, resource, duration }
  - skill = 具体技能名（如"Excel 数据透视表"、"客户沟通话术"）
  - resource = 学习渠道（如"B 站免费教程"、"政府公益培训"，不指名具体培训机构）
  - duration = 大致时间（如"2 周"、"1 个月"）
- interviewTips: 3-5 条字符串，每条具体可执行

【硬约束】（极重要）
- **每条 applyDirection.tip / skillUp / interviewTips 必须包含具体动作 + 可验证产出 + 时间锚点**
  - 反例（不要写）："多投简历"、"提升能力"、"准备面试"（这是泛泛而谈，对失业用户是反向打击）
  - 正例：
    - "本周修改简历的工作描述部分，把'负责招聘'改为'招聘 N 人，到岗周期从 X 天降到 Y 天'"
    - "下周完成 3 次模拟自我介绍录音，每次控制在 90 秒内"
- 不指名具体公司、培训机构、政府服务名称
- 不要出现 MBTI / 大五 / 霍兰德等专有名词
- recent_grad（离校未就业）：建议偏"找到第一份工作的关键步骤"，重点强调校招/见习/实习途径、积累首份经历、考相关证书
- young_unemployed（35岁以下失业青年）：建议偏"快速再就业"，可提政府公益培训（通用表达，不指名机构），不嘲讽空白期
- general_unemployed（一般失业人员）：建议偏"用过往经历快速找到匹配岗位"，不嘲讽空白期，强调务实可落地
- 不写黄浦/上海具体资源链接（用户决策不接黄浦资源）；可在 applyDirection 里以"上海公共招聘网"作通用引导，但仅作为渠道之一

输出 JSON schema:
{
  "applyDirection": [{ "channel": "string", "tip": "string" }],
  "skillUp": [{ "skill": "string", "resource": "string", "duration": "string" }],
  "interviewTips": ["string"]
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

// 不达标补 mock 项：从 MOCK_ADVICE 里依次补足，保证条数达到下限
function patchAdvice(d: Advice): Advice {
  const out: Advice = {
    applyDirection: Array.isArray(d.applyDirection)
      ? d.applyDirection.filter(
          (a) =>
            a &&
            typeof a === "object" &&
            !isBadString(a.channel, 3) &&
            !isBadString(a.tip, 15)
        )
      : [],
    skillUp: Array.isArray(d.skillUp)
      ? d.skillUp.filter(
          (s) =>
            s &&
            typeof s === "object" &&
            !isBadString(s.skill, 2) &&
            !isBadString(s.resource, 4) &&
            !isBadString(s.duration, 2)
        )
      : [],
    interviewTips: Array.isArray(d.interviewTips)
      ? d.interviewTips.filter((t) => !isBadString(t, 15))
      : [],
  };
  // applyDirection 至少 3 条
  let i = 0;
  while (out.applyDirection.length < 3 && i < MOCK_ADVICE.applyDirection.length) {
    const cand = MOCK_ADVICE.applyDirection[i++];
    if (!out.applyDirection.some((x) => x.channel === cand.channel)) {
      out.applyDirection.push(cand);
    }
  }
  // skillUp 至少 2 条
  i = 0;
  while (out.skillUp.length < 2 && i < MOCK_ADVICE.skillUp.length) {
    const cand = MOCK_ADVICE.skillUp[i++];
    if (!out.skillUp.some((x) => x.skill === cand.skill)) {
      out.skillUp.push(cand);
    }
  }
  // interviewTips 至少 3 条
  i = 0;
  while (out.interviewTips.length < 3 && i < MOCK_ADVICE.interviewTips.length) {
    const cand = MOCK_ADVICE.interviewTips[i++];
    if (!out.interviewTips.includes(cand)) {
      out.interviewTips.push(cand);
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  // E2E mock 短路：跑测试时不烧 LLM 额度
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

  // 拼 prompt：身份/学历/年限/简历 + 四维 + 能力六维评分
  const baseCtx = buildBaseContext(formData);
  const userPrompt = [
    `请严格按约定 JSON 输出"行动建议"章节（applyDirection / skillUp / interviewTips）。`,
    "",
    baseCtx,
    "",
    buildScoringSummary(scoring),
    "",
    `提醒：每条建议必须含具体动作 + 可验证产出 + 时间锚点；不要写"多投简历""提升能力""准备面试"这种空话。`,
  ].join("\n");

  try {
    const data = await callWithFallback<Advice>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1800,
      temperature: 0.6,
      validator: validateAdvice,
      context: "advice",
    });
    // 即便通过 validator，再 patch 一次保证条数达到下限（防御性兜底）
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
          : "行动建议章节生成失败";

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
