import { NextRequest, NextResponse } from "next/server";
import {
  APPLICANT_BASELINE,
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
  // reasoning / industries 已从 UI 移除，软校验：有就格式对，没有也行
  if (rec.reasoning !== undefined && typeof rec.reasoning !== "string")
    return `${label}.reasoning 格式错误`;
  if (rec.industries !== undefined && !Array.isArray(rec.industries))
    return `${label}.industries 格式错误`;
  if (isBadString(rec.culture, 4)) return `${label}.culture 缺失`;
  if (isBadString(rec.teamRole, 2)) return `${label}.teamRole 缺失`;
  // 核心职责：建议有 5 条，但不强制失败
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

function normalizePositioning(d: Positioning, scoring: ScoringResult): Positioning {
  // 雷达图 score = 用户 6 维能力分的「组内相对匹配度」：
  //   用户最强维度 → 96，最弱 → 68，中间线性映射到 [68, 96]。
  // 理由：图标题是「核心能力匹配」，匹配度是相对概念。若用绝对分，
  //   能力分普遍偏低的用户会看到「全是低分」的雷达图，与「首选推荐」
  //   自相矛盾（既然不匹配为何推荐）。
  // 自洽性：映射只依赖用户自己的能力分布 → 同一维度在首选/次选两个
  //   岗位雷达图里落点仍完全一致（不破坏 v0.9.4 的修复）。
  const abilityScores = scoring.ability.map((a) => a.score);
  const userMax = Math.max(...abilityScores);
  const userMin = Math.min(...abilityScores);
  const range = Math.max(userMax - userMin, 1);
  const toMatchScore = (raw: number) =>
    Math.round(68 + ((raw - userMin) / range) * 28); // → [68, 96]
  // 能力名 → 匹配度（用于雷达图）
  const abilityMatchMap = new Map(
    scoring.ability.map((a) => [a.name, toMatchScore(a.score)] as const)
  );
  // 能力名 → 原始分（仅用于"不足 5 项时按强项补齐"的排序）
  const abilityRawMap = new Map(
    scoring.ability.map((a) => [a.name, a.score] as const)
  );

  const normalizeRec = (rec: PositionRecommendation): PositionRecommendation => {
    // coreCompetencies：LLM 只负责「选哪 5 个维度」（体现岗位差异），
    // score 强制用「组内相对匹配度」。LLM 编的维度名只保留能映射到 6 维的。
    const rawComps = Array.isArray(rec.coreCompetencies)
      ? rec.coreCompetencies
      : [];
    const pickedNames = rawComps
      .filter((c) => c && typeof c === "object" && typeof c.name === "string")
      .map((c) => String(c.name).trim())
      .filter((name) => abilityMatchMap.has(name));
    const uniqueNames = [...new Set(pickedNames)];
    const comps: { name: string; score: number }[] = uniqueNames.map(
      (name) => ({ name, score: abilityMatchMap.get(name)! })
    );
    // 不足 5 项 → 用量表里还没选中的维度按「原始分」从高到低补齐（优先补强项）
    if (comps.length < 5) {
      const picked = new Set(comps.map((c) => c.name));
      const remaining = [...scoring.ability]
        .filter((a) => !picked.has(a.name))
        .sort((x, y) => (abilityRawMap.get(y.name)! - abilityRawMap.get(x.name)!));
      for (const a of remaining) {
        if (comps.length >= 5) break;
        comps.push({ name: a.name, score: abilityMatchMap.get(a.name)! });
      }
    }

    return {
      ...rec,
      matchScore: clampScore(rec.matchScore),
      industries: (rec.industries ?? [])
        .map((s) => String(s).trim())
        .filter((s) => s.length > 0),
      coreResponsibilities: Array.isArray(rec.coreResponsibilities)
        ? rec.coreResponsibilities.map((r) => String(r).trim()).filter(Boolean)
        : undefined,
      coreCompetencies: comps.slice(0, 5),
      fitReason:
        typeof rec.fitReason === "string" && rec.fitReason.trim().length > 0
          ? rec.fitReason.trim()
          : undefined,
    };
  };
  return {
    primary: normalizeRec(d.primary),
    secondary: normalizeRec(d.secondary),
  };
}

const SYSTEM_PROMPT = `你是黄浦区职业咨询师。基于用户的简历、身份、四维 + 能力评分、目标岗位，推荐首选 + 次选岗位。

${APPLICANT_BASELINE}

【任务】生成"职业定位"，含：
- primary: { position, matchScore (0-100), culture, teamRole, coreResponsibilities, coreCompetencies, fitReason }
- secondary: 同结构，提供差异化路径
字段说明：
  - coreResponsibilities: **5 条**该岗位的核心职责
    * 每条 **14-25 字**，**长度刻意不一致**形成错落感（不要 5 条全是 14 字或全是 25 字）
    * 至少 2 条偏长（20-25 字），偏长的含简短场景或限定词
    * 写法：动作 + 对象（+ 可选场景）
    * 例：「组织跨部门协调会议并跟进结果」「对接外部供应商，谈判合同条款」「统筹年度预算编制与执行复盘」
  - coreCompetencies: **恰好 5 项**该岗位最看重的核心能力，格式 { name: string }
    * **name 必须从以下 6 个固定能力维度里选 5 个**（一字不差，不要自创名称、不要加字）：
      沟通表达 / 协作意识 / 执行落地 / 学习能力 / 信息处理 / 压力适应
    * 选维度规则（6 选 5，只排除 1 个）：在「该岗位看重」的前提下，
      **优先排除"用户量表能力分最低 且 该岗位相对不那么依赖"的那个维度** ——
      让选中的 5 维尽量是用户的相对强项，使推荐岗位与用户能力结构契合
      （这是"首选/次选推荐"成立的前提，雷达图才不会自相矛盾）
    * 岗位差异体现在「选了哪 5 个维度」：不同岗位看重的能力不同
      （如技术岗常选 信息处理+学习能力+执行落地，服务岗常选 沟通表达+协作意识+压力适应），
      primary 和 secondary 的维度组合应不同
    * **不要输出 score 字段** —— 雷达图分数由系统统一计算填充，确保逻辑自洽
  - fitReason: 60-80 字，简明点出 1-2 个最关键的匹配理由（结合用户经历或量表特点），语气正向但克制，不堆砌

【岗位推荐规则】（极重要 — 必须严格按 APPLICANT_BASELINE 的身份指南选岗）
1. **应届（recent_grad）**：从 APPLICANT_BASELINE 中应届的"推荐方向"选岗
2. **35-（young_unemployed）**：从 APPLICANT_BASELINE 中 35- 的"推荐方向"选岗
3. **35+（general_unemployed）**：**必须从 APPLICANT_BASELINE 的"白名单"中选**，严禁跳出；若简历显示有过硬技能（如行业经验深、技术工种、经营经验），可推该白名单内的"师傅/讲师/顾问/店长"档位
4. 根据简历自适应水位：简历强可推稍高一档；简历薄推入门门槛
5. 不推荐用户简历完全不匹配的岗位
6. 用户填的 targetPosition 是参考但不是强约束 —— 如果 35+ 用户填了不合身份的 target（如"产品经理"），仍按白名单推，可以在 reasoning 里委婉提到"该岗位招聘倾向年轻群体，结合您的过往经验，更适合从下列方向切入"

【fitReason 措辞红线】
- 严格遵守 APPLICANT_BASELINE 的禁用词清单
- 不写"虽然年龄..."、"虽然没经验..."、"虽然空白期..."等转折句
- 直接讲匹配点，不必给"安慰"

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
    "culture": "string",
    "teamRole": "string",
    "coreResponsibilities": ["14-25 字 偏短", "14-25 字 偏短", "20-25 字 偏长", "14-25 字 中等", "20-25 字 偏长"],
    "coreCompetencies": [{ "name": "六维之一" }, { "name": "六维之一" }, { "name": "六维之一" }, { "name": "六维之一" }, { "name": "六维之一" }],
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
    const data = normalizePositioning(raw, scoring);
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
