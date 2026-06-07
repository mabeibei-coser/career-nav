/**
 * 报告统一生成端点（单次请求 · 单次 LLM 调用 · 一次性吐 5 章节）
 *
 * 历史背景：曾用「5 个 generateXXX 串行 + context threading」生成（commit c19703e 之前），
 * 章节间一致性靠 prompt 拼接前面输出实现，但偶发逻辑反向（截图 bug：性格四维偏右、定位却写"稳健"）。
 * 串行也无法让后面的章节真正"看到"前面的整体分布——LLM 只能看到拼进 prompt 的片段。
 *
 * 现在改回 39ce354 那次重构的方向（合并成单次调用），并补上 39ce354 当时缺的:
 *  - overview 双极倾向 + 反向词全字段校验 + 同链路 retry 钩子（b270a80 + v0.10.19）
 *  - validator 失败时携带具体修正方向重写一次，再失败才走兜底
 *  - 失败兜底从"局部 mock"改回"整体 mock"（与 39ce354 一致）
 *
 * 章节间一致性靠 prompt 内的"全局规则"和 LLM 一次性看全输入的整体感来约束。
 *
 * 兼容性：response 仍是 { data: { overview, strength, positioning, resumeDiagnosis, advice }, source }，
 * 前端 report-client.ts / loading 页无需改动。
 */
import { NextRequest, NextResponse } from "next/server";
import {
  APPLICANT_BASELINE,
  buildBaseContext,
  callWithFallback,
  COMPANY_NO_NAME_NOTE,
  FORBIDDEN_FRAUD_NOTE,
} from "@/lib/report-shared";
import {
  MOCK_ADVICE,
  MOCK_OVERVIEW,
  MOCK_POSITIONING,
  MOCK_RESUME_DIAGNOSIS,
  MOCK_STRENGTH,
} from "@/lib/mocks/report-mocks";
import {
  POLE_KEYWORDS,
  REVERSE_WORD_ISSUE_PREFIX,
  collectAllOverviewText,
  detectReverseWords,
  tendencyChip,
} from "@/lib/overview-tendency";
import type {
  Advice,
  InterviewQ1Q2,
  JobFormData,
  Overview,
  Positioning,
  PositionRecommendation,
  ResumeDiagnosis,
  ScoringResult,
  Strength,
} from "@/lib/types";

export const runtime = "nodejs";
// 单次大调用：输出 ~6000-8000 tokens，P95 估 60-100s
// 主链路 120s + 讯飞兜底 120s = 最坏 240s，maxDuration 留足 buffer
export const maxDuration = 300;

// 单次大调用硬超时：讯飞完整 5 模块偶发会超过 120s；前端 fetch 250s，服务端留一点余量。
const COMBINED_TIMEOUT_MS = 220_000;

// ============================================================
// 通用 helpers
// ============================================================

const PLACEHOLDER_RE = [
  /^\.{2,}$/, /^<[^>]*>$/, /^x{2,}$/i, /^示例/, /^请填/, /^\d+\s*-\s*\d+\s*字/,
];
function isBad(s: unknown, min = 2): boolean {
  if (typeof s !== "string") return true;
  const t = s.trim();
  return t.length < min || PLACEHOLDER_RE.some((re) => re.test(t));
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function numClamp(n: number, lo: number, hi: number) {
  return !Number.isFinite(n) ? lo : Math.min(Math.max(n, lo), hi);
}

const ABILITY_NAMES = ["沟通表达", "协作意识", "执行落地", "学习能力", "信息处理", "压力适应"];

const PRIORITY_VALUES = ["high", "medium", "low"] as const;
type Priority = (typeof PRIORITY_VALUES)[number];
function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITY_VALUES as readonly string[]).includes(v);
}

const VAGUE_WHOLE_STRINGS: RegExp[] = [
  /^多投简历$/, /^提升能力$/, /^准备面试$/, /^好好学习$/, /^加油$/,
];

// ============================================================
// 响应类型
// ============================================================

interface AllSections {
  overview: Overview;
  strength: Strength;
  positioning: Positioning;
  resumeDiagnosis: ResumeDiagnosis | null;
  advice: Advice;
}

// ============================================================
// 合并 system prompt — 5 模块一次性吐
// ============================================================

function buildMegaSystemPrompt(hasResume: boolean): string {
  const resumeBlock = hasResume
    ? `
【模块 ④ resumeDiagnosis（简历快诊）】
身份：职业指导老师（不是招聘官，措辞支持性而非审判性）
- overallScore: 0-100（评估"简历呈现质量"，不是用户能力本身）
- issues: 1-4 条 { title (10-15字), detail (40-80字), priority "high"/"medium"/"low", quotedSnippet?, revisionExample (40-80字针对本条问题的具体改写) }
- suggestions: 2-4 条 { title, detail（具体可执行） }
- revisionExample 格式：「改前：XXX → 改后：XXX」或直接给出改后版本
硬约束：
- 用"可以补充"、"建议加上"，不用"问题严重"、"完全没有"
- 不嘲讽空白期；Q1/Q2 提供的空白期解释，建议组织进简历
- 不建议造假；不指名具体公司；不出现 MBTI/大五等
- 建议方向参考 overview 性格定位，措辞保持一致
`
    : "\n【模块 ④ resumeDiagnosis】用户未上传简历，本字段必须输出为 null（不要输出对象）\n";

  return `你是黄浦区职业咨询师，一次性生成用户的完整职业导航报告（5 个模块）。

${APPLICANT_BASELINE}

【全局规则 — 必须严格遵守，章节间逻辑闭环】
1. 章节生成顺序在脑子里走：overview → strength → positioning → resumeDiagnosis → advice
2. **性格定位**（overview.personality.type）一旦决定，strength 的优势描述语气、positioning 的选岗逻辑、advice 的行动方向都要与之呼应
3. **推荐岗位**（positioning.primary/secondary.position）一旦决定，advice 的 topThree 不能与推荐岗位方向矛盾
4. **能力雷达**（strength.abilityRadar）的 score **必须使用入参 scoring 中的数值**，禁止重新计算（后端会再次覆写）
5. **四维评分**（overview.fourDimRadar）同样照搬入参 scoring.fourDim 数值
   ※ 注意：positioning.coreCompetencies 是另一套打分逻辑（按岗位定制），后端**不会**覆写，由你自己根据简历 + 量表 + 访谈综合给分，详见模块 ③
6. 简历改进建议（resumeDiagnosis.suggestions）一旦给出，advice 不要重复同样内容

【模块 ① overview（总评）】
1. personality.type：4-10 字纯中文职业性格定位（如"稳健型执行者"、"成长驱动型开拓者"），严禁字母代码/缩写
2. personality.traits：3-4 个性格标签（每个 2-4 字）
3. personality.description：80-120 字，结合四维评分和 Q1/Q2 访谈，写职场实际表现
4. fourDimRadar：4 项 { name, score, conclusion }，name 严格用「性格底色/工作风格/价值驱动/适配方向」，score 照搬入参，conclusion ≤30 字（描述该维度用户的突出特点，**方向必须呼应分数**）
5. summary：120-150 字综述，鼓励 + 务实语气，融入访谈信息

【overview 硬约束 ① — 所有文本字段必须呼应四维倾向，不得反向】
约束覆盖范围：personality.type / personality.traits / personality.description / fourDimRadar[i].conclusion / summary —— 任一字段写反方向都视为逻辑矛盾，会被自动拒收 retry。
- 价值驱动**偏探索成长**（score ≥ 61）：**严禁** "稳健 / 务实 / 守成 / 本分 / 安稳 / 踏实肯干"，应呼应 "探索 / 进取 / 开拓 / 拼搏 / 成长"
- 价值驱动**偏稳定务实**（score ≤ 40）：**严禁** "探索 / 进取 / 开拓 / 野心 / 拼搏 / 突破"，应呼应 "稳健 / 务实 / 踏实"
- 工作风格**偏灵活应变**（score ≥ 61）：**严禁** "按部就班 / 守规 / 保守 / 刻板 / 墨守成规"，应呼应 "灵活 / 应变 / 敏捷"
- 工作风格**偏按部就班**（score ≤ 40）：**严禁** "灵活 / 应变 / 敏捷"，应呼应 "按部就班 / 规范 / 稳健"
- 性格底色**偏主动外向**（score ≥ 61）：**严禁** "内敛 / 内向 / 沉静 / 安静寡言"，应呼应 "外向 / 活跃 / 开朗"
- 性格底色**偏内敛沉稳**（score ≤ 40）：**严禁** "外向 / 活跃 / 开朗 / 热情奔放"，应呼应 "内敛 / 沉静"
- 适配方向**偏多元适应**（score ≥ 61）：**严禁** "深耕 / 专精 / 钻研 / 聚焦"，应呼应 "多元 / 跨界 / 广博"
- 适配方向**偏专注深耕**（score ≤ 40）：**严禁** "多元 / 跨界 / 广博"，应呼应 "深耕 / 专精 / 聚焦"
- 特别提示：fourDimRadar[i].conclusion 是对该维度突出特点的 30 字描述——比如「价值驱动」偏右时不能写"追求稳定与务实"，应写"追求成长与突破"

【overview 硬约束 ② — 其他】
- personality.type 严禁 MBTI / 大五 / 霍兰德 / ISTJ / ENFJ 等专有名词或字母代码
- personality.type 示例库（按四维主导倾向挑选，不得反向）：
  - 多维偏左：稳健型执行者 / 沉稳协调者 / 务实深耕者 / 踏实型守成者
  - 多维偏右：成长驱动型开拓者 / 灵活适应型推动者 / 主动进取型探索者 / 多元跨界型协作者
  - 部分左部分右：温和型推动者 / 务实进取型协作者 / 稳中求进型探索者

【模块 ② strength（优势发现）】
1. abilityRadar: 6 项 { name, score }，name 严格按「沟通表达 / 协作意识 / 执行落地 / 学习能力 / 信息处理 / 压力适应」，score 照搬入参
2. strengths: 3 条 { title (8-12字), detail (60-80字，结合简历找具体证据) }
3. growth: 2 条 { title, detail }，用"可以多做 X"的正向语气，避免审判性
硬约束：
- recent_grad 重点说"潜力"；求职者重点说"已积累的经验"，不嘲讽空白期
- 描述语气与 overview.personality 保持一致

【模块 ③ positioning（职业定位）】
- primary: { position, matchScore (0-100), culture, teamRole, coreResponsibilities (5条，14-25字，长度刻意错落), coreCompetencies ([{name, score}] 必须 5 项), fitReason (60-80字), specialNote (40-70字具体可执行建议) }
- secondary: 同结构，coreCompetencies 与 primary **至少 3 项名称不同**（两个岗位是不同能力画像）
- position 要具体（如「薪酬绩效专员」而不是「人力资源」）
- targetPosition 是用户自述方向，不是默认首选答案：
  a) 与能力契合 → 首选可以是它或升阶版
  b) 方向对但够不着 → 首选推更匹配的，次选放目标
  c) 明显不匹配 → 首选推真正匹配的，fitReason 诚恳说明

【positioning.coreCompetencies 核心约束 — 必须严格遵守】

**① name 按"该推荐岗位真实需要的能力"定义，不是固定 6 维**
- 一字不差**禁止使用**这 6 个泛化标签作为 name：「沟通表达」「协作意识」「执行落地」「学习能力」「信息处理」「压力适应」——这些是测评维度，不是岗位能力画像
- 必须根据 position 写**岗位特定的能力**，4-8 字，体现该岗位真正在用什么
- 例：
  - 客户服务专员（金融）→ 客户沟通话术 / 业务流程熟练 / 投诉化解能力 / 合规话术意识 / 情绪稳定度
  - 行政人事助理 → 多线事务调度 / 公文与档案规范 / 跨部门协调 / 劳动法规基础 / 细致与零差错
  - 数据分析助理 → 数据敏感度 / Excel/SQL 操作 / 业务理解力 / 图表呈现 / 结论提炼
  - 运营专员（消费品）→ 用户洞察 / 内容文案能力 / 数据驱动思维 / 项目推进 / 跨部门沟通
- 命名风格：具体动作 + 对象（"客户沟通话术"），或具体场景能力（"投诉化解能力"），不要"沟通能力""协作能力"这种宽口径
- primary 与 secondary 各自一套，**至少 3 项名称不同**

**② score 综合三方面打分（0-100 整数）**
- (a) 量表 6 维能力分数（沟通表达/协作意识/...）作**底数**：把它们映射到与本岗位 name 最相关的那项上
- (b) 简历经历中的相关证据：该项能力在简历里有过硬证据（项目经历、量化成果）→ 加分；简历完全没体现 → 不加分但也不重罚
- (c) Q1/Q2 访谈反映的表达 / 思考状态：访谈表达清晰、对该岗位理解到位 → 加分
- **后端不会覆写 score**，你必须自己给出，且要数值合理（避免全部接近 80 这种平均化）

**③ 整体水位偏「合适」，但要诚恳指出不足**
- 5 项分数**均值 ≥ 72**（让用户感觉"基本胜任"）
- 3-4 项落在 **75-90** 区间（"擅长 / 较擅长"段位）
- **至少 1 项 落在 55-70**（短板，用于指出"还需提升"）；不允许 5 项全部 ≥ 75（看起来像吹捧）
- 短板项必须在 fitReason 或 specialNote 里**点名提到**该具体能力名，并给一句"如何补"的可执行建议
- 反例（禁止）：
  - 全部 ≥ 80 → 用户感觉不真诚
  - 多项 < 55 → 整体偏向"不合适"，违背产品方向
  - 5 项均值 < 70 → 同上

硬约束：
- ${COMPANY_NO_NAME_NOTE}
- ${FORBIDDEN_FRAUD_NOTE}
- general_unemployed 必须从 APPLICANT_BASELINE 白名单选岗
- 与 overview.personality.type、strength.strengths 主要优势保持逻辑一致
${resumeBlock}
【模块 ⑤ advice（行动建议）】
topThree — 用户下一步最重要的三件事，按优先级从高到低。每件事：
- title: 4-10 字动作标题（如"重写简历核心经历"）
- detail: 50-100 字，必须包含「做什么 + 怎么做 + 做到什么程度」，不泛泛而谈
- deadline: 建议完成时间锚点（如"本周内"、"两周内"），不写"尽快"
硬约束：
- 严格 3 条
- detail 必须含具体动作 + 可验证产出，禁用空话（"多投简历"、"提升能力"等）
- 严格遵守 APPLICANT_BASELINE 禁用词清单
- 不指名具体公司 / 培训机构；不出现 MBTI / 大五等
- **行动方向必须与 positioning 推荐岗位一致**，不能与之矛盾

【最终输出 JSON schema】
{
  "overview": {
    "personality": { "type": "string", "traits": ["string"], "description": "string" },
    "fourDimRadar": [{ "name": "string", "score": 0, "conclusion": "string" }],
    "summary": "string"
  },
  "strength": {
    "abilityRadar": [{ "name": "string", "score": 0 }],
    "strengths": [{ "title": "string", "detail": "string" }],
    "growth": [{ "title": "string", "detail": "string" }]
  },
  "positioning": {
    "primary": { "position": "string", "matchScore": 0, "culture": "string", "teamRole": "string", "coreResponsibilities": ["string"], "coreCompetencies": [{ "name": "string", "score": 0 }], "fitReason": "string", "specialNote": "string" },
    "secondary": { "position": "string", "matchScore": 0, "culture": "string", "teamRole": "string", "coreResponsibilities": ["string"], "coreCompetencies": [{ "name": "string", "score": 0 }], "fitReason": "string", "specialNote": "string" }
  },
  "resumeDiagnosis": ${hasResume ? `{ "overallScore": 0, "issues": [{ "title": "string", "detail": "string", "priority": "high|medium|low", "revisionExample": "string" }], "suggestions": [{ "title": "string", "detail": "string" }] }` : "null"},
  "advice": { "topThree": [{ "title": "string", "detail": "string", "deadline": "string" }] }
}

注意：上述 schema 里的 "string" / 0 都是占位类型说明，必须替换为真实内容；任何 "..."、空串、"<...>" 都会被拒收。`;
}

function buildMegaUserPrompt(
  formData: JobFormData,
  scoring: ScoringResult,
  q1q2: InterviewQ1Q2
): string {
  const ivParts: string[] = [];
  if (q1q2.Q1?.trim()) ivParts.push(`Q1 回答：${q1q2.Q1.trim()}`);
  if (q1q2.Q2?.trim()) ivParts.push(`Q2 回答：${q1q2.Q2.trim()}`);

  const baseCtx = buildBaseContext(formData, undefined, ivParts.join("\n") || undefined);
  // 四维同时给数值 + 双极倾向 chip，让 LLM 看到分数也能立刻得出方向，避免在 personality.type / conclusion 上写反
  const fourDimLines = scoring.fourDim
    .map((d) => `- ${d.name}（${d.dimension}）：${d.score} 分 → ${tendencyChip(d.score, d.dimension)}`)
    .join("\n");
  const abilityLines = scoring.ability
    .map((a) => `- ${a.name}：${a.score} 分`)
    .join("\n");

  return [
    `请严格按 schema 一次性输出包含 5 个模块的完整 JSON。`,
    "",
    baseCtx,
    "",
    "【性格四维评分（overview.fourDimRadar 必须照搬，且所有 overview 文本必须呼应右侧倾向标签）】",
    fourDimLines,
    "",
    "【能力六维评分（strength.abilityRadar 必须照搬；positioning.coreCompetencies 把这 6 个作为打分底数参考，但 name 要按岗位定制、score 综合简历+量表+访谈自行打）】",
    abilityLines,
    "",
    "提醒：",
    "- overview.fourDimRadar / strength.abilityRadar 的 score 必须严格照抄上述数值，后端会覆写；输出错也会触发校验失败重试。",
    "- positioning.coreCompetencies 的 name **不要**用上面 6 个泛化标签，按岗位定制；score 由你综合三方面（简历证据 / 量表底数 / Q1Q2 访谈）自行打分，后端**不覆写**——所以要打得合理且符合「整体偏合适、至少 1 项明显短板」的水位约束。",
  ].join("\n");
}

// ============================================================
// 各模块 validator
// ============================================================

function validateOverviewShape(d: Overview): string | null {
  if (!d?.personality) return "overview.personality 缺失";
  if (isBad(d.personality.type, 2)) return "overview.personality.type 占位符";
  if (
    !Array.isArray(d.personality.traits) ||
    d.personality.traits.length < 3 ||
    d.personality.traits.some((t) => isBad(t, 2))
  )
    return "overview.traits 缺失或不足 3 项";
  if (isBad(d.personality.description, 30)) return "overview.description 过短";
  if (!Array.isArray(d.fourDimRadar) || d.fourDimRadar.length !== 4)
    return "overview.fourDimRadar 必须 4 项";
  if (isBad(d.summary, 50)) return "overview.summary 过短";
  return null;
}

function validateStrength(d: Strength): string | null {
  if (!Array.isArray(d?.abilityRadar) || d.abilityRadar.length !== 6)
    return "strength.abilityRadar 必须 6 项";
  if (!Array.isArray(d.strengths) || d.strengths.length < 3) return "strength.strengths 至少 3 条";
  for (const s of d.strengths)
    if (!s || isBad(s.title) || isBad(s.detail, 20)) return "strength.strengths 条目缺失";
  if (!Array.isArray(d.growth) || d.growth.length < 2) return "strength.growth 至少 2 条";
  for (const g of d.growth)
    if (!g || isBad(g.title) || isBad(g.detail, 20)) return "strength.growth 条目缺失";
  return null;
}

// 6 个量表泛化标签——positioning.coreCompetencies.name 不允许直接使用
const GENERIC_ABILITY_TAGS = new Set([
  "沟通表达", "协作意识", "执行落地", "学习能力", "信息处理", "压力适应",
]);

function validatePositionRec(
  rec: PositionRecommendation | undefined,
  label: string
): string | null {
  if (!rec || typeof rec !== "object") return `${label} 缺失`;
  if (isBad(rec.position, 2)) return `${label}.position 缺失`;
  if (typeof rec.matchScore !== "number" || !Number.isFinite(rec.matchScore))
    return `${label}.matchScore 非数字`;
  if (isBad(rec.culture, 4)) return `${label}.culture 缺失`;
  if (isBad(rec.teamRole, 2)) return `${label}.teamRole 缺失`;

  // 核心能力雷达：必须 5 项，name 按岗位定制（禁泛化标签），score 0-100 数字
  if (!Array.isArray(rec.coreCompetencies) || rec.coreCompetencies.length < 5)
    return `${label}.coreCompetencies 必须 5 项`;
  const seen = new Set<string>();
  for (const c of rec.coreCompetencies.slice(0, 5)) {
    if (!c || typeof c.name !== "string" || !c.name.trim())
      return `${label}.coreCompetencies.name 缺失`;
    const name = c.name.trim();
    // 「泛化标签 / 重复 name」是内容质量（命名够不够岗位定制），不是结构问题：
    // 讯飞常用「沟通表达」等泛化词、偶有重名，硬拒收会触发 retry → 超时 → 掉 mock。
    // 降级为只 warn；name 非空 / 数量 5 项 / score 合法 这些结构硬校验保留。
    if (GENERIC_ABILITY_TAGS.has(name))
      console.warn(`[positioning-competency] ${label}.coreCompetencies 用了泛化标签「${name}」（不拒收，仅记录）`);
    else if (seen.has(name))
      console.warn(`[positioning-competency] ${label}.coreCompetencies 出现重复 name「${name}」（不拒收，仅记录）`);
    seen.add(name);
    if (typeof c.score !== "number" || !Number.isFinite(c.score) || c.score < 0 || c.score > 100)
      return `${label}.coreCompetencies.score 非法（${String(c.score)}）`;
  }
  return null;
}

const POSITIONING_WATERLINE_ISSUE_PREFIX = "positioning-waterline";

function validatePositioningWaterline(d: Positioning): string | null {
  const issues: string[] = [];
  // 整体偏「合适」：均值 ≥ 70，至少 1 项 ≤ 70（明显短板），primary/secondary 重叠 ≤ 2
  for (const [label, rec] of [["primary", d.primary], ["secondary", d.secondary]] as const) {
    const scores = (rec.coreCompetencies ?? []).slice(0, 5).map((c) => c.score);
    if (scores.length < 5) continue;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg < 70) issues.push(`${label} 均值 ${avg.toFixed(1)} 偏低（应 ≥ 72）`);
    if (!scores.some((s) => s <= 70))
      issues.push(`${label} 缺少明显短板项（应至少 1 项 ≤ 70 用于诚恳指出不足）`);
  }
  const pNames = new Set((d.primary.coreCompetencies ?? []).slice(0, 5).map((c) => c.name.trim()));
  const sNames = (d.secondary.coreCompetencies ?? []).slice(0, 5).map((c) => c.name.trim());
  const overlap = sNames.filter((n) => pNames.has(n)).length;
  if (overlap > 2)
    issues.push(`primary/secondary coreCompetencies 重叠 ${overlap} 项（应 ≤ 2）`);
  return issues.length === 0 ? null : `${POSITIONING_WATERLINE_ISSUE_PREFIX}: ${issues.join("; ")}`;
}

function validatePositioning(d: Positioning): string | null {
  const p = validatePositionRec(d?.primary, "positioning.primary");
  if (p) return p;
  const s = validatePositionRec(d?.secondary, "positioning.secondary");
  if (s) return s;
  const w = validatePositioningWaterline(d);
  // 水位质检（均值≥70 + 至少 1 项≤70）降级为只 warn、不再拒收：这两个条件互相打架、
  // 窄窗口，讯飞带随机性难稳定凑齐；凑不齐就废掉整份报告 → 同链路 retry → retry 超时
  // （Request aborted）→ 两链路都失败 → 静默掉 mock（社保局演示翻车根因）。
  // 报告可用性不依赖该分数水位；coreCompetencies 的形状校验已在 validatePositionRec 保留。
  if (w) console.warn("[positioning-waterline] 软提示（不拒收，仅记录）:", w);
  return null;
}

function validateResumeDiagnosis(data: ResumeDiagnosis): string | null {
  if (!data || typeof data !== "object") return "resumeDiagnosis 不是对象";
  if (typeof data.overallScore !== "number") return "resumeDiagnosis.overallScore 不是数字";
  data.overallScore = Math.round(numClamp(data.overallScore, 0, 100));
  if (!Array.isArray(data.issues) || data.issues.length === 0) return "resumeDiagnosis.issues 为空";
  if (data.issues.length > 4) data.issues = data.issues.slice(0, 4);
  for (const it of data.issues) {
    if (!it || typeof it.title !== "string" || !it.title.trim()) return "resumeDiagnosis.issue.title 缺失";
    if (typeof it.detail !== "string" || !it.detail.trim()) return "resumeDiagnosis.issue.detail 缺失";
    if (!isPriority(it.priority)) return `resumeDiagnosis.issue.priority 非法: ${String(it.priority)}`;
  }
  if (!Array.isArray(data.suggestions) || data.suggestions.length < 2)
    return "resumeDiagnosis.suggestions 不足 2 条";
  if (data.suggestions.length > 4) data.suggestions = data.suggestions.slice(0, 4);
  for (const s of data.suggestions) {
    if (typeof s.title !== "string" || !s.title.trim()) return "resumeDiagnosis.suggestion.title 缺失";
    if (typeof s.detail !== "string" || !s.detail.trim()) return "resumeDiagnosis.suggestion.detail 缺失";
  }
  return null;
}

function validateAdvice(d: Advice): string | null {
  if (!Array.isArray(d?.topThree) || d.topThree.length < 3) return "advice.topThree 必须 3 条";
  for (const item of d.topThree) {
    if (!item || typeof item !== "object") return "advice.topThree 元素非对象";
    if (isBad(item.title, 4) || VAGUE_WHOLE_STRINGS.some((re) => re.test(String(item.title))))
      return "advice.topThree.title 缺失/过泛";
    if (isBad(item.detail, 20)) return "advice.topThree.detail 缺失/过短";
    if (isBad(item.deadline, 2)) return "advice.topThree.deadline 缺失";
  }
  return null;
}

/**
 * 大调用 validator：5 模块全做形状校验 + overview 全字段反向词校验。
 * scoring 闭包传入，给反向词检测用；retry hook 拿到 issue 字符串后用前缀判断要不要喂回 LLM。
 */
function buildAllValidator(hasResume: boolean, scoring: ScoringResult) {
  return (d: AllSections): string | null => {
    const oErr = validateOverviewShape(d.overview);
    if (oErr) return oErr;
    const sErr = validateStrength(d.strength);
    if (sErr) return sErr;
    const pErr = validatePositioning(d.positioning);
    if (pErr) return pErr;
    if (hasResume) {
      if (d.resumeDiagnosis === null) return "hasResume=true 但 resumeDiagnosis 为 null";
      const rErr = validateResumeDiagnosis(d.resumeDiagnosis);
      if (rErr) return rErr;
    }
    // 无简历时 resumeDiagnosis 应为 null，不校验
    const aErr = validateAdvice(d.advice);
    if (aErr) return aErr;

    // 全字段反向词质检（type + traits + description + 4 conclusion + summary）。
    // 这属于内容质量检查，不应把结构完整的真实报告整份打成 mock。
    const text = collectAllOverviewText(d.overview);
    const conflicts = detectReverseWords(text, scoring.fourDim);
    if (conflicts.length > 0) {
      const summary = conflicts
        .map((c) => {
          const side = c.tendency === "left" ? "偏左" : "偏右";
          const dimScore = scoring.fourDim.find((x) => x.dimension === c.dimension)!;
          return `${c.dimensionName}（${side}：${tendencyChip(dimScore.score, c.dimension)}）出现反向核心词 [${c.hits.join("、")}]`;
        })
        .join("; ");
      console.warn("[overview-reverse-word] 软提示（不拒收，仅记录）:", summary);
    }
    return null;
  };
}

/**
 * 反向词冲突 retry 钩子：把违规字段 + 应呼应方向喂回 LLM，同链路重试一次。
 * 仅在反向词冲突时触发；形状校验失败不重试（重试同 prompt 没意义）。
 */
function buildOnValidationFailure(
  scoring: ScoringResult,
  userPrompt: string
) {
  return (issue: string, data: AllSections): { userPrompt: string } | null => {
    // 分支 1：positioning coreCompetencies 水位修正
    if (issue.startsWith(POSITIONING_WATERLINE_ISSUE_PREFIX)) {
      const dumpRec = (label: string, rec: PositionRecommendation | undefined) => {
        const items = (rec?.coreCompetencies ?? [])
          .slice(0, 5)
          .map((c) => `${c.name}=${c.score}`)
          .join(", ");
        return `  ${label}（${rec?.position ?? "?"}）: [${items}]`;
      };
      const feedback = [
        "",
        "═══ 上一轮 positioning.coreCompetencies 水位不达标，必须修正后重新生成完整 JSON ═══",
        `问题：${issue.replace(POSITIONING_WATERLINE_ISSUE_PREFIX + ": ", "")}`,
        "上一轮输出：",
        dumpRec("primary", data.positioning?.primary),
        dumpRec("secondary", data.positioning?.secondary),
        "",
        "【修正方向】整体偏「合适」 + 诚恳指出不足：",
        "- 5 项分数均值 ≥ 72（让用户感觉基本胜任）",
        "- 3-4 项落 75-90 区间（擅长 / 较擅长）",
        "- 至少 1 项落 55-70（短板，必须在 fitReason / specialNote 里点名提到并给可执行建议）",
        "- primary 与 secondary 至少 3 项 name 不同",
        "",
        "请重新输出完整 5 模块 JSON：positioning 严格按上述水位重写；其他模块保持上一轮内容（如果一致就照搬）。不要解释，直接输出新 JSON。",
      ].join("\n");
      return { userPrompt: userPrompt + feedback };
    }

    // 分支 2：overview 反向词冲突修正
    if (!issue.startsWith(REVERSE_WORD_ISSUE_PREFIX)) return null;
    const text = collectAllOverviewText(data.overview);
    const conflicts = detectReverseWords(text, scoring.fourDim);
    if (conflicts.length === 0) return null;

    const fixLines = conflicts.map((c) => {
      const dimScore = scoring.fourDim.find((x) => x.dimension === c.dimension)!;
      const chip = tendencyChip(dimScore.score, c.dimension);
      const dict = POLE_KEYWORDS[c.dimension];
      const avoid = (c.tendency === "left" ? dict.right : dict.left).join("、");
      const echo = (c.tendency === "left" ? dict.left : dict.right).slice(0, 4).join("、");
      return `- ${c.dimensionName}（${chip}，分数 ${dimScore.score}）：上次输出含反向词 [${c.hits.join("、")}]。**严禁** "${avoid}"；**应呼应** "${echo}" 等方向词`;
    });

    const conclusions = Array.isArray(data.overview?.fourDimRadar)
      ? data.overview.fourDimRadar
          .map((r, i) => `  [${i}] ${r?.name ?? ""}: ${r?.conclusion ?? ""}`)
          .join("\n")
      : "";

    const feedback = [
      "",
      "═══ 上一轮 overview 输出存在逻辑反向问题，必须修正后重新生成完整 JSON ═══",
      `上一轮 personality.type = "${data.overview?.personality?.type ?? ""}"`,
      `上一轮 traits = ${JSON.stringify(data.overview?.personality?.traits ?? [])}`,
      `上一轮 personality.description = "${data.overview?.personality?.description ?? ""}"`,
      `上一轮 fourDimRadar.conclusion:`,
      conclusions,
      `上一轮 summary = "${data.overview?.summary ?? ""}"`,
      "",
      "【冲突清单 + 修正方向】",
      ...fixLines,
      "",
      "请重新输出完整 5 模块 JSON：overview 的 type / traits / description / 4 个 conclusion / summary **全部**按上述方向重写；strength / positioning / resumeDiagnosis / advice 跟着 overview 新的性格定位重写一致版本。所有 score 数值不变。不要解释，直接输出新 JSON。",
    ].join("\n");

    return { userPrompt: userPrompt + feedback };
  };
}

// ============================================================
// 后处理 normalize + patch + 整体 mock
// ============================================================

function normalizeOverview(d: Overview, scoring: ScoringResult): Overview {
  d.fourDimRadar = scoring.fourDim.map((dim, i) => ({
    name: dim.name,
    score: dim.score,
    ...(d.fourDimRadar[i]?.conclusion ? { conclusion: d.fourDimRadar[i].conclusion } : {}),
  }));
  if (d.personality?.type) {
    d.personality.type = d.personality.type
      .replace(/^[A-Za-z]{2,6}\s*[·\-:、|/]\s*/, "")
      .replace(/[（(][A-Za-z\s/]{2,12}[）)]/g, "")
      .trim();
  }
  return d;
}

function normalizeStrength(d: Strength, scoring: ScoringResult): Strength {
  d.abilityRadar = scoring.ability.map((a) => ({ name: a.name, score: a.score }));
  return d;
}

function normalizePositioning(d: Positioning): Positioning {
  // coreCompetencies 不再被量表分覆写——validator 已经保证形状（5 项、name 非泛化、score 0-100）
  // 这里只做去重、裁剪、clamp、trim
  const normalizeRec = (rec: PositionRecommendation): PositionRecommendation => {
    const rawComps = Array.isArray(rec.coreCompetencies) ? rec.coreCompetencies : [];
    const seen = new Set<string>();
    const comps: { name: string; score: number }[] = [];
    for (const c of rawComps) {
      if (!c || typeof c.name !== "string") continue;
      const name = c.name.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      comps.push({ name, score: clampScore(c.score) });
      if (comps.length >= 5) break;
    }
    return {
      ...rec,
      matchScore: clampScore(rec.matchScore),
      industries: (rec.industries ?? []).map((s) => String(s).trim()).filter(Boolean),
      coreResponsibilities: Array.isArray(rec.coreResponsibilities)
        ? rec.coreResponsibilities.map((r) => String(r).trim()).filter(Boolean)
        : undefined,
      coreCompetencies: comps,
      fitReason:
        typeof rec.fitReason === "string" && rec.fitReason.trim()
          ? rec.fitReason.trim()
          : undefined,
      specialNote:
        typeof rec.specialNote === "string" && rec.specialNote.trim()
          ? rec.specialNote.trim()
          : undefined,
    };
  };
  return { primary: normalizeRec(d.primary), secondary: normalizeRec(d.secondary) };
}

function patchAdvice(d: Advice): Advice {
  const valid = Array.isArray(d.topThree)
    ? d.topThree.filter(
        (item) =>
          item &&
          !isBad(item.title, 4) &&
          !VAGUE_WHOLE_STRINGS.some((re) => re.test(String(item.title))) &&
          !isBad(item.detail, 20) &&
          !isBad(item.deadline, 2),
      )
    : [];
  let i = 0;
  while (valid.length < 3 && i < MOCK_ADVICE.topThree.length) {
    const cand = MOCK_ADVICE.topThree[i++];
    if (!valid.some((x) => x.title === cand.title)) valid.push(cand);
  }
  return { topThree: valid.slice(0, 3) };
}

function buildAllMock(scoring: ScoringResult, hasResume: boolean): AllSections {
  return {
    overview: {
      ...MOCK_OVERVIEW,
      fourDimRadar: scoring.fourDim.map((d, i) => ({
        name: d.name,
        score: d.score,
        ...(MOCK_OVERVIEW.fourDimRadar[i]?.conclusion
          ? { conclusion: MOCK_OVERVIEW.fourDimRadar[i].conclusion }
          : {}),
      })),
    },
    strength: {
      ...MOCK_STRENGTH,
      abilityRadar: scoring.ability.map((a) => ({ name: a.name, score: a.score })),
    },
    positioning: MOCK_POSITIONING,
    resumeDiagnosis: hasResume ? MOCK_RESUME_DIAGNOSIS : null,
    advice: MOCK_ADVICE,
  };
}

// ============================================================
// Route Handler
// ============================================================

export async function POST(req: NextRequest) {
  if (process.env.E2E_MOCK_MODE === "true") {
    return NextResponse.json({
      data: {
        overview: MOCK_OVERVIEW,
        strength: MOCK_STRENGTH,
        positioning: MOCK_POSITIONING,
        resumeDiagnosis: MOCK_RESUME_DIAGNOSIS,
        advice: MOCK_ADVICE,
      } satisfies AllSections,
      source: "mock",
    });
  }

  let formData: JobFormData;
  let scoring: ScoringResult;
  let interviewQ1Q2: InterviewQ1Q2;

  try {
    const body = await req.json();
    formData = body.formData as JobFormData;
    scoring = body.scoring as ScoringResult;
    interviewQ1Q2 = (body.interviewQ1Q2 as InterviewQ1Q2) ?? {};

    if (!formData?.identity) {
      return NextResponse.json({
        data: null,
        source: "mock",
        errorMessage: "缺少 formData.identity",
      });
    }
    if (!scoring?.fourDim || !Array.isArray(scoring.fourDim) || scoring.fourDim.length !== 4) {
      return NextResponse.json({
        data: null,
        source: "mock",
        errorMessage: "scoring.fourDim 缺失或非 4 项",
      });
    }
    if (!scoring?.ability || !Array.isArray(scoring.ability) || scoring.ability.length !== 6) {
      return NextResponse.json({
        data: null,
        source: "mock",
        errorMessage: "scoring.ability 缺失或非 6 项",
      });
    }
  } catch {
    return NextResponse.json({
      data: null,
      source: "mock",
      errorMessage: "请求体解析失败",
    });
  }

  const hasResume = (formData.resumeText ?? "").trim().length >= 50;

  // ---- 单次大调用：一次 LLM 吐 5 章节 ----
  const userPrompt = buildMegaUserPrompt(formData, scoring, interviewQ1Q2);
  let raw: AllSections;
  try {
    raw = await callWithFallback<AllSections>({
      systemPrompt: buildMegaSystemPrompt(hasResume),
      userPrompt,
      // 放开原 8000 上限：完整报告 JSON 偶尔 >8000 token 会被硬截断（tryFixAndParse 只能补括号、补不回内容）。
      // 实际生效模型是讯飞 astron-code-latest（输出上限 3.2 万+），16000 给正常输出量（~6000-8000）留 2x buffer，
      // 消除截断且不逼近 120s 硬超时（max_tokens 只是上限，模型吐完 JSON 即止，不会强行吐满）。
      maxTokens: 16000,
      temperature: 0.6,
      timeoutMs: COMBINED_TIMEOUT_MS,
      validator: buildAllValidator(hasResume, scoring),
      onValidationFailure: buildOnValidationFailure(scoring, userPrompt),
      context: "report-all",
    });
  } catch (e) {
    console.error("[generate] 单次大调用失败，全 mock 兜底:", e);
    return NextResponse.json({
      data: buildAllMock(scoring, hasResume),
      source: "mock",
      errorMessage: e instanceof Error ? e.message : String(e),
    });
  }

  // ---- 后处理：强制覆写 score / normalize / patch ----
  const overview = normalizeOverview(raw.overview, scoring);
  const strength = normalizeStrength(raw.strength, scoring);
  const positioning = normalizePositioning(raw.positioning);
  const resumeDiagnosis: ResumeDiagnosis | null = hasResume
    ? (raw.resumeDiagnosis ?? MOCK_RESUME_DIAGNOSIS)
    : null;
  const advice = patchAdvice(raw.advice);

  return NextResponse.json({
    data: {
      overview,
      strength,
      positioning,
      resumeDiagnosis,
      advice,
    } satisfies AllSections,
    source: "deepseek",
  });
}
