import { NextRequest, NextResponse } from "next/server";
import {
  APPLICANT_BASELINE,
  buildBaseContext,
  callWithFallback,
} from "@/lib/report-shared";
import { getMockBySection } from "@/lib/mocks/report-mocks";
import type {
  InterviewQ1Q2,
  JobFormData,
  Overview,
  ScoringResult,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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

function validateOverview(d: Overview): string | null {
  if (!d || typeof d !== "object") return "overview 根对象缺失";
  if (!d.personality || typeof d.personality !== "object")
    return "personality 缺失";
  if (isBadString(d.personality.type, 2)) return "personality.type 缺失/占位符";
  if (
    !Array.isArray(d.personality.traits) ||
    d.personality.traits.length < 3 ||
    d.personality.traits.some((t) => isBadString(t, 2))
  )
    return "personality.traits 缺失或不足 3 项";
  if (isBadString(d.personality.description, 30))
    return "personality.description 缺失/过短";
  if (!Array.isArray(d.fourDimRadar) || d.fourDimRadar.length !== 4)
    return "fourDimRadar 必须为 4 项";
  if (isBadString(d.summary, 50)) return "summary 缺失/过短";
  return null;
}

const SYSTEM_PROMPT = `你是黄浦区职业咨询师。基于用户的「性格四维评分」+「Q1/Q2/Q3 访谈回答」生成性格综述。

${APPLICANT_BASELINE}

【任务】生成一份"职业性格总评"，包含：
1. personality.type：MBTI 四字母代码 + 4-6 字中文定位，格式为 "XXXX · 中文定位"（如 "ENFJ · 温和型推动者"、"ISTJ · 可靠执行者"、"INFP · 理想探索者"）。必须基于四维评分和访谈内容合理推断 MBTI 倾向，不要随意分配
2. personality.traits：3-4 个性格标签（每个 2-4 字）
3. personality.description：80-120 字描述，结合四维评分和 Q1/Q2/Q3 访谈内容，写该性格在职场的实际表现——最受欢迎的场合 + 最容易掉坑的场合，白描不鸡汤
4. fourDimRadar：4 项 { name, score, conclusion }，name 严格用「性格底色 / 工作风格 / 价值驱动 / 适配方向」，score 严格用入参 scoring.fourDim 的对应值（不重新计算！），conclusion 是该维度的简短文字结论（不超过 30 字，描述用户在该维度的突出特点）
5. summary：120-150 字综述，鼓励 + 务实语气，融入 Q1/Q2/Q3 访谈信息（若 Q3 提供了有价值的背景，优先融入）

【硬约束】
- personality.type 必须是 "XXXX · 中文定位" 格式，XXXX 为合法 MBTI 四字母（E/I + S/N + T/F + J/P）
- 对外不要出现"MBTI"这三个字母作为标签，仅输出四字母代码 + 中文定位
- 描述用户身份：recent_grad（应届毕业生）/ young_unemployed（35岁以下求职者）/ general_unemployed（35岁以上求职者），措辞要贴合身份；非应届求职者不要嘲讽空白期或就业经历
- fourDimRadar 的 score 必须照搬入参，不要 LLM 重算
- 输出必须是合法 JSON，字段名严格匹配下方 schema

输出 JSON schema:
{
  "personality": { "type": "string", "traits": ["string"], "description": "string" },
  "fourDimRadar": [{ "name": "string", "score": number, "conclusion": "string" }],
  "summary": "string"
}`;

function buildInterviewSummary(q1q2: InterviewQ1Q2): string | undefined {
  const parts: string[] = [];
  if (q1q2.Q1?.trim()) parts.push(`Q1 回答：${q1q2.Q1.trim()}`);
  if (q1q2.Q2?.trim()) parts.push(`Q2 回答：${q1q2.Q2.trim()}`);
  if (q1q2.Q3?.trim()) parts.push(`Q3 回答：${q1q2.Q3.trim()}`);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function buildScoringSummary(scoring: ScoringResult): string {
  const lines = scoring.fourDim.map(
    (d) => `- ${d.name}（${d.dimension}）：${d.score} 分`
  );
  return ["性格四维评分：", ...lines].join("\n");
}

export async function POST(req: NextRequest) {
  // ---- 1. 解析 + 校验入参（任一异常都返回 200 + mock，不让前端崩） ----
  let formData: JobFormData;
  let scoring: ScoringResult;
  let interviewQ1Q2: InterviewQ1Q2;
  try {
    const body = await req.json();
    const fd = body?.formData as JobFormData | undefined;
    const sc = body?.scoring as ScoringResult | undefined;
    const iv = (body?.interviewQ1Q2 as InterviewQ1Q2 | undefined) ?? {};

    if (!fd?.identity) {
      return NextResponse.json(
        {
          data: null,
          source: "mock" as const,
          errorMessage: "缺少表单关键字段（identity）",
        },
        { status: 200 }
      );
    }
    if (
      !sc?.fourDim ||
      !Array.isArray(sc.fourDim) ||
      sc.fourDim.length !== 4
    ) {
      return NextResponse.json(
        {
          data: null,
          source: "mock" as const,
          errorMessage: "scoring.fourDim 必须为 4 项",
        },
        { status: 200 }
      );
    }
    formData = fd;
    scoring = sc;
    interviewQ1Q2 = iv;
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : "请求体解析失败";
    return NextResponse.json(
      {
        data: getMockBySection("overview"),
        source: "mock" as const,
        errorMessage: msg,
      },
      { status: 200 }
    );
  }

  // E2E mock 短路：跑测试时不烧 LLM 额度
  if (process.env.E2E_MOCK_MODE === "true") {
    const mock = getMockBySection("overview") as Overview;
    const data: Overview = {
      ...mock,
      fourDimRadar: scoring.fourDim.map((d, i) => ({
        name: d.name,
        score: d.score,
        ...(mock.fourDimRadar[i]?.conclusion ? { conclusion: mock.fourDimRadar[i].conclusion } : {}),
      })),
    };
    return NextResponse.json({ data, source: "mock" as const });
  }

  // ---- 2. 拼 prompt：buildBaseContext 基线 + 四维评分 + Q1Q2 摘要 ----
  const interviewSummary = buildInterviewSummary(interviewQ1Q2);
  const baseCtx = buildBaseContext(formData, undefined, interviewSummary);
  const userPrompt = [
    `请严格按约定 JSON 输出"总评"章节。`,
    "",
    baseCtx,
    "",
    buildScoringSummary(scoring),
    "",
    `提醒：fourDimRadar 的 score 必须严格照抄上述四维评分数值，不要重新计算。`,
  ].join("\n");

  try {
    const data = await callWithFallback<Overview>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1500,
      temperature: 0.6,
      validator: validateOverview,
      context: "overview",
    });

    // 强制覆写 fourDimRadar score：LLM 可能瞎编 score，用入参强行覆盖；但保留 LLM 生成的 conclusion
    data.fourDimRadar = scoring.fourDim.map((d, i) => ({
      name: d.name,
      score: d.score,
      ...(data.fourDimRadar[i]?.conclusion ? { conclusion: data.fourDimRadar[i].conclusion } : {}),
    }));

    // source 判断：DeepSeek 主链路成功用 "deepseek"；callWithFallback 内部
    // 切到讯飞会 console.warn 但不把 caller 信息透传出来——这里以 success 路径
    // 默认 deepseek（讯飞兜底是低概率事件，错认对前端无害）
    return NextResponse.json(
      { data, source: "deepseek" as const },
      { status: 200 }
    );
  } catch (err) {
    console.error("[overview] both LLM links failed, fallback to mock:", err);
    const message =
      err instanceof AggregateError
        ? err.errors
            .map((e) => (e instanceof Error ? e.message : String(e)))
            .join(" | ")
        : err instanceof Error
          ? err.message
          : "总评章节生成失败";

    // 兜底 mock 时也强制对齐 fourDimRadar，保证前端雷达图数值与入参一致
    const mock = getMockBySection("overview") as Overview;
    const fallback: Overview = {
      ...mock,
      fourDimRadar: scoring.fourDim.map((d, i) => ({
        name: d.name,
        score: d.score,
        ...(mock.fourDimRadar[i]?.conclusion ? { conclusion: mock.fourDimRadar[i].conclusion } : {}),
      })),
    };
    return NextResponse.json(
      {
        data: fallback,
        source: "mock" as const,
        errorMessage: message,
      },
      { status: 200 }
    );
  }
}
