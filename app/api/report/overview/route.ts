import { NextRequest, NextResponse } from "next/server";
import {
  APPLICANT_BASELINE,
  buildBaseContext,
  callWithFallback,
} from "@/lib/report-shared";
import {
  POLE_KEYWORDS,
  POLE_LABELS,
  REVERSE_WORD_ISSUE_PREFIX,
  collectAllOverviewText,
  detectReverseWords,
  tendencyChip,
} from "@/lib/overview-tendency";
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

/**
 * 基础结构校验（字段缺失/占位符/长度）。
 * 反向词冲突校验在 POST 内闭包包装 scoring 后做（见 localValidator）。
 */
function validateOverviewShape(d: Overview): string | null {
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
1. personality.type：4-10 字的纯中文职业性格定位。基于四维评分倾向和访谈内容提炼，**绝不能出现任何字母代码或缩写**
2. personality.traits：3-4 个性格标签（每个 2-4 字）
3. personality.description：80-120 字描述，结合四维评分和 Q1/Q2/Q3 访谈内容，写该性格在职场的实际表现——最受欢迎的场合 + 最容易掉坑的场合，白描不鸡汤
4. fourDimRadar：4 项 { name, score, conclusion }，name 严格用「性格底色 / 工作风格 / 价值驱动 / 适配方向」，score 严格用入参 scoring.fourDim 的对应值（不重新计算！），conclusion 是该维度的简短文字结论（不超过 30 字，描述用户在该维度的突出特点）
5. summary：120-150 字综述，鼓励 + 务实语气，融入 Q1/Q2/Q3 访谈信息（若 Q3 提供了有价值的背景，优先融入）

【personality.type 示例库 — 必须按四维主导倾向挑选与之呼应的方向，不得反向】
偏稳定 / 守成 / 内敛 / 深耕方向（用于多维偏左）：
  "稳健型执行者"、"沉稳协调者"、"务实深耕者"、"踏实型守成者"
偏成长 / 探索 / 灵活 / 多元方向（用于多维偏右）：
  "成长驱动型开拓者"、"灵活适应型推动者"、"主动进取型探索者"、"多元跨界型协作者"
混合 / 较均衡（部分维度偏左部分偏右）：
  "温和型推动者"、"务实进取型协作者"、"稳中求进型探索者"

【硬约束 — 所有文本字段必须呼应四维倾向，不得反向】
约束覆盖范围：personality.type、personality.traits、personality.description、fourDimRadar[i].conclusion、summary —— 任一字段写反方向都视为逻辑矛盾，会被自动拒收。
- 若价值驱动**偏探索成长**（score ≥ 61）：**严禁**出现 "稳健 / 务实 / 守成 / 本分 / 安稳 / 踏实肯干" 等反向核心词，应呼应 "探索 / 进取 / 开拓 / 拼搏 / 成长"
- 若价值驱动**偏稳定务实**（score ≤ 40）：**严禁**出现 "探索 / 进取 / 开拓 / 野心 / 拼搏 / 突破" 等反向核心词，应呼应 "稳健 / 务实 / 踏实"
- 若工作风格**偏灵活应变**（score ≥ 61）：**严禁**出现 "按部就班 / 守规 / 保守 / 刻板 / 墨守成规" 等反向核心词，应呼应 "灵活 / 应变 / 敏捷"
- 若工作风格**偏按部就班**（score ≤ 40）：**严禁**出现 "灵活 / 应变 / 敏捷" 等反向核心词，应呼应 "按部就班 / 规范 / 稳健"
- 若性格底色**偏主动外向**（score ≥ 61）：**严禁**出现 "内敛 / 内向 / 沉静 / 安静寡言" 等反向核心词，应呼应 "外向 / 活跃 / 开朗"
- 若性格底色**偏内敛沉稳**（score ≤ 40）：**严禁**出现 "外向 / 活跃 / 开朗 / 热情奔放" 等反向核心词，应呼应 "内敛 / 沉静"
- 若适配方向**偏多元适应**（score ≥ 61）：**严禁**出现 "深耕 / 专精 / 钻研 / 聚焦" 等反向核心词，应呼应 "多元 / 跨界 / 广博"
- 若适配方向**偏专注深耕**（score ≤ 40）：**严禁**出现 "多元 / 跨界 / 广博" 等反向核心词，应呼应 "深耕 / 专精 / 聚焦"
- 特别提示：fourDimRadar[i].conclusion 是对该维度突出特点的 30 字描述——比如「价值驱动」偏右时不能写"追求稳定与务实"，应写"追求成长与突破"

【其他硬约束】
- personality.type 是纯中文性格定位（4-10 字），**严禁出现 MBTI / 大五 / 霍兰德等专有名词，严禁出现 ISTJ / ENFJ 这类四字母代码或任何字母缩写**
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
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function buildScoringSummary(scoring: ScoringResult): string {
  // 把前端展示给用户的"偏左 / 较均衡 / 偏右"语义标签也喂给 LLM —— 仅给数字它会忽略方向
  const lines = scoring.fourDim.map((d) => {
    const p = POLE_LABELS[d.dimension];
    return `- ${d.name}（${d.dimension}）：${d.score} 分 → ${tendencyChip(d.score, d.dimension)}（${p.left} ←→ ${p.right}）`;
  });
  return ["性格四维评分（含双极倾向，必须呼应）：", ...lines].join("\n");
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

  // ---- 闭包 validator：在基础 shape 校验之上叠加反向词冲突校验 ----
  // 校验覆盖全部文本字段：type + traits + description + 4 个 conclusion + summary
  // 之前只看 type+traits 是漏洞——LLM 把 type 写对但在 conclusion/description 写反向词，会逃过校验
  const localValidator = (d: Overview): string | null => {
    const shapeIssue = validateOverviewShape(d);
    if (shapeIssue) return shapeIssue;
    const text = collectAllOverviewText(d);
    const conflicts = detectReverseWords(text, scoring.fourDim);
    if (conflicts.length > 0) {
      const summary = conflicts
        .map((c) => {
          const side = c.tendency === "left" ? "偏左" : "偏右";
          return `${c.dimensionName}（${side}：${tendencyChip(scoring.fourDim.find((d) => d.dimension === c.dimension)!.score, c.dimension)}）出现反向核心词 [${c.hits.join("、")}]`;
        })
        .join("; ");
      return `${REVERSE_WORD_ISSUE_PREFIX}: ${summary}`;
    }
    return null;
  };

  // ---- 同链路 retry 钩子：反向词冲突 → 把违规清单和应呼应方向喂回 LLM ----
  const onValidationFailure = (
    issue: string,
    data: Overview
  ): { userPrompt: string } | null => {
    if (!issue.startsWith(REVERSE_WORD_ISSUE_PREFIX)) return null; // shape 错误不 retry
    const text = collectAllOverviewText(data);
    const conflicts = detectReverseWords(text, scoring.fourDim);
    if (conflicts.length === 0) return null;

    const fixLines = conflicts.map((c) => {
      const dimScore = scoring.fourDim.find((d) => d.dimension === c.dimension)!;
      const chip = tendencyChip(dimScore.score, c.dimension);
      const dict = POLE_KEYWORDS[c.dimension];
      const avoid = (c.tendency === "left" ? dict.right : dict.left).join("、");
      const echo = (c.tendency === "left" ? dict.left : dict.right).slice(0, 4).join("、");
      return `- ${c.dimensionName}（${chip}，分数 ${dimScore.score}）：上次输出含反向词 [${c.hits.join("、")}]。**严禁**使用 "${avoid}" 这类反向词；**应呼应** "${echo}" 等方向词`;
    });

    const conclusions = Array.isArray(data.fourDimRadar)
      ? data.fourDimRadar.map((r, i) => `  [${i}] ${data.fourDimRadar[i]?.name ?? ""}: ${r?.conclusion ?? ""}`).join("\n")
      : "";

    const feedback = [
      "",
      "═══ 上一轮输出存在逻辑反向问题，必须修正后重新生成 ═══",
      `上一轮 personality.type = "${data.personality?.type ?? ""}"`,
      `上一轮 traits = ${JSON.stringify(data.personality?.traits ?? [])}`,
      `上一轮 personality.description = "${data.personality?.description ?? ""}"`,
      `上一轮 fourDimRadar.conclusion:`,
      conclusions,
      `上一轮 summary = "${data.summary ?? ""}"`,
      "",
      "【冲突清单 + 修正方向】",
      ...fixLines,
      "",
      "请重新输出完整 JSON：fourDimRadar 数值不变；type / traits / description / 4 个 conclusion / summary **全部**按上述方向重写——任一字段出现反向词都会再次被拒。不要解释，直接输出新 JSON。",
    ].join("\n");

    return { userPrompt: userPrompt + feedback };
  };

  try {
    const data = await callWithFallback<Overview>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 1500,
      temperature: 0.6,
      validator: localValidator,
      onValidationFailure,
      context: "overview",
    });

    // 强制覆写 fourDimRadar score：LLM 可能瞎编 score，用入参强行覆盖；但保留 LLM 生成的 conclusion
    data.fourDimRadar = scoring.fourDim.map((d, i) => ({
      name: d.name,
      score: d.score,
      ...(data.fourDimRadar[i]?.conclusion ? { conclusion: data.fourDimRadar[i].conclusion } : {}),
    }));

    // 防御性清理 personality.type：剥掉 LLM 可能残留的字母代码前缀（如 "ISTJ · 稳健型执行者"）
    // CLAUDE.md 红线：严禁 MBTI 专有名词，ISTJ/ENFJ 这类四字母代码也算
    if (data.personality?.type) {
      data.personality.type = data.personality.type
        .replace(/^[A-Za-z]{2,6}\s*[·\-:、|/]\s*/, "") // 开头 "XXXX · " 前缀
        .replace(/[（(][A-Za-z\s/]{2,12}[）)]/g, "")    // 括号里的字母代码
        .trim();
    }

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
