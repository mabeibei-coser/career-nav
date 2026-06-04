/**
 * SJT 题目生成（LLM 调用 + 兜底题）
 * 由 /api/quiz/bank/generated 路由调用。
 *
 * LLM 只输出题干 + 选项文本 + 能力维度标签（不输出数值权重）
 * → 输出 tokens 从 ~2500 降到 ~900，完成时间从 >25s 降到 ~6-10s
 * → 数值权重由服务端模板映射：primary=1.0，secondary=0.5
 */
import { callWithFallback, identityLabelOf } from "@/lib/report-shared";
import type { JobFormData, QuizQuestion, AbilityKey } from "@/lib/types";

// ===== 7 道兜底 SJT 题（LLM 失败 / E2E Mock 时使用）=====
// SJT-01（workstyle）已作为固定题目存放在 data/quiz-bank.json 的 fixedQuestions 中
// 这 7 道覆盖全部 4 个维度（personality×2, workstyle×1, value×2, direction×2）
export const FALLBACK_GENERATED: QuizQuestion[] = [
  {
    id: "SJT-03",
    dimension: "workstyle",
    text: "手头同时有三项任务，截止日期都在本周。你会怎么安排？",
    options: [
      { label: "A", text: "按紧急程度排序，先做最急的，做完一项再做下一项", poleValue: 25, weights: { execution: 1.0, stress: 0.5 } },
      { label: "B", text: "估算每项工作量，给每项分配时间块，交叉推进", poleValue: 35, weights: { execution: 0.9, data: 0.7 } },
      { label: "C", text: "问一下各方哪项最优先，按他们的期待来安排顺序", poleValue: 78, weights: { communication: 0.9, collaboration: 0.6 } },
      { label: "D", text: "先把能快速完成的做掉，建立节奏，再处理复杂的", poleValue: 22, weights: { execution: 0.8, learning: 0.4 } },
    ],
  },
  {
    id: "SJT-04",
    dimension: "value",
    text: "工作中要求你用一个完全没用过的新工具，并在三天内产出结果。你会怎么做？",
    options: [
      { label: "A", text: "直接动手试，边用边看官方文档，出错再查", poleValue: 82, weights: { learning: 1.0, execution: 0.6 } },
      { label: "B", text: "先花一两个小时系统看教程，搞清楚基本逻辑再开始", poleValue: 55, weights: { learning: 0.9, data: 0.6 } },
      { label: "C", text: "找用过这个工具的人请教，让他们帮我快速上手", poleValue: 60, weights: { collaboration: 1.0, communication: 0.6 } },
      { label: "D", text: "如果来不及，提前说明风险并建议用熟悉的方案替代", poleValue: 20, weights: { communication: 0.8, stress: 0.5 } },
    ],
  },
  {
    id: "SJT-05",
    dimension: "direction",
    text: "你正在全力推进一项工作时，上级突然说要把截止日期提前两天。你的第一反应是什么？",
    options: [
      { label: "A", text: "立刻重新评估任务，看哪些可以简化，保证提前交付", poleValue: 32, weights: { execution: 1.0, stress: 0.6 } },
      { label: "B", text: "告诉上级现在的进展和风险，一起商量什么可以提前交付", poleValue: 78, weights: { communication: 1.0, collaboration: 0.5 } },
      { label: "C", text: "加班加点，想办法在新截止日前完成，不让上级失望", poleValue: 18, weights: { execution: 0.8, stress: 0.7 } },
      { label: "D", text: "先冷静下来，想清楚哪部分最核心，集中精力保核心先出", poleValue: 42, weights: { stress: 1.0, data: 0.5 } },
    ],
  },
  {
    id: "SJT-06",
    dimension: "personality",
    text: "你认为某个常用的做事方法效率很低，有更好的方案，但团队一直在用旧方法。你会怎么做？",
    options: [
      { label: "A", text: "默默按旧方法做，在自己权限内小范围测试新方案", poleValue: 20, weights: { execution: 0.8, learning: 0.6 } },
      { label: "B", text: "找合适时机向负责人提出来，展示新方案的具体好处", poleValue: 75, weights: { communication: 1.0, execution: 0.5 } },
      { label: "C", text: "先和几个同事聊，看他们是否也有同感，再集体提出", poleValue: 82, weights: { collaboration: 1.0, communication: 0.7 } },
      { label: "D", text: "研究一下为什么用旧方法，弄清楚背后原因再决定要不要提", poleValue: 35, weights: { data: 0.9, learning: 0.7 } },
    ],
  },
  {
    id: "SJT-07",
    dimension: "value",
    text: "你负责整理一份有大量数据的分析报告，数据来源混乱、格式各异。你会怎么处理？",
    options: [
      { label: "A", text: "先把所有数据汇总进来，统一格式，再逐步分析", poleValue: 22, weights: { data: 1.0, execution: 0.6 } },
      { label: "B", text: "先弄清楚报告的核心问题，只收集与核心问题相关的数据", poleValue: 65, weights: { data: 0.8, communication: 0.5 } },
      { label: "C", text: "找数据来源的负责人沟通，请他们统一格式再给我", poleValue: 35, weights: { collaboration: 0.9, communication: 0.7 } },
      { label: "D", text: "搜索有没有现成工具或模板可以帮助快速整理这类数据", poleValue: 78, weights: { learning: 1.0, data: 0.5 } },
    ],
  },
  {
    id: "SJT-08",
    dimension: "personality",
    text: "你在一次团队复盘会上，发现你的工作方式受到了一些批评。你通常会怎么反应？",
    options: [
      { label: "A", text: "认真听，问清楚具体哪里有问题，下次做调整", poleValue: 62, weights: { learning: 1.0, communication: 0.6 } },
      { label: "B", text: "解释一下当时的考虑，让大家理解为什么这么做", poleValue: 78, weights: { communication: 0.9, stress: 0.4 } },
      { label: "C", text: "会有些情绪，但事后冷静下来会去想批评是否有道理", poleValue: 28, weights: { stress: 0.9, learning: 0.5 } },
      { label: "D", text: "和提出批评的人单独聊，进一步了解他们的想法", poleValue: 52, weights: { collaboration: 0.9, communication: 0.7 } },
    ],
  },
  {
    id: "SJT-09",
    dimension: "direction",
    text: "你加入了一个新项目，发现大家各自为战、缺少统一节奏。你会怎么做？",
    options: [
      { label: "A", text: "专注做好自己分内的部分，不越权干涉别人的工作", poleValue: 20, weights: { execution: 1.0, stress: 0.4 } },
      { label: "B", text: "把自己负责的模块做完整，顺手帮旁边人解答疑问", poleValue: 38, weights: { execution: 0.8, collaboration: 0.5 } },
      { label: "C", text: "主动和几个核心成员拉通一下，把各自进度和依赖说清楚", poleValue: 72, weights: { communication: 1.0, collaboration: 0.7 } },
      { label: "D", text: "建议组织一次简短站会，把整体进度和分工梳理清楚", poleValue: 85, weights: { communication: 0.9, collaboration: 0.8 } },
    ],
  },
];

// ===== 有效能力维度 =====
const VALID_ABILITY_KEYS: AbilityKey[] = [
  "communication", "collaboration", "execution", "learning", "data", "stress",
];

// ===== LLM 简化输出格式 =====
const VALID_DIMENSIONS = ["personality", "workstyle", "value", "direction"] as const;
type LLMDimension = typeof VALID_DIMENSIONS[number];

interface LLMSimpleOption {
  label: string;
  text: string;
  primary: string;       // 主能力维度：communication / collaboration / execution / learning / data / stress
  secondary?: string;    // 副能力维度（可选）
  poleValue: number;     // 0-100：该题维度光谱上的位置（0=强左极，100=强右极）
}
interface LLMSimpleQuestion {
  text: string;
  dimension: LLMDimension;  // personality / workstyle / value / direction
  options: LLMSimpleOption[];
}
interface LLMSimpleBank {
  questions: LLMSimpleQuestion[];
}

function validateSimpleBank(data: LLMSimpleBank): string | null {
  if (!data || !Array.isArray(data.questions)) return "questions 字段缺失";
  if (data.questions.length !== 6) return `questions 长度应为 6，实际 ${data.questions.length}`;
  const validLabels = new Set(["A", "B", "C", "D"]);
  const dimSet = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const q = data.questions[i];
    if (!q || typeof q.text !== "string" || q.text.trim().length < 10)
      return `questions[${i}].text 无效`;
    if (!VALID_DIMENSIONS.includes(q.dimension as LLMDimension))
      return `questions[${i}].dimension 无效: "${q.dimension}"`;
    dimSet.add(q.dimension);
    if (!Array.isArray(q.options) || q.options.length !== 4)
      return `questions[${i}].options 必须有 4 个，实际 ${q.options?.length}`;
    for (const opt of q.options) {
      if (!validLabels.has(opt.label)) return `questions[${i}] 非法 label: ${opt.label}`;
      if (typeof opt.text !== "string" || opt.text.trim().length < 5)
        return `questions[${i}].${opt.label} text 过短`;
      if (!VALID_ABILITY_KEYS.includes(opt.primary as AbilityKey))
        return `questions[${i}].${opt.label} primary 无效: "${opt.primary}"`;
      if (typeof opt.poleValue !== "number" || opt.poleValue < 0 || opt.poleValue > 100)
        return `questions[${i}].${opt.label} poleValue 无效: ${opt.poleValue}`;
    }
  }
  // 至少覆盖 3 个维度（允许不全覆盖，评分系统有 fallback）
  if (dimSet.size < 3) return `维度覆盖不足 3 个，实际 ${dimSet.size} 个`;
  return null;
}

/** 模板权重：primary = 1.0，secondary = 0.5；保留 dimension 和 poleValue */
function normalizeSimpleBank(data: LLMSimpleBank): QuizQuestion[] {
  return data.questions.map((q, i) => ({
    id: `SJT-0${i + 3}`, // SJT-03 to SJT-08
    dimension: q.dimension,
    text: q.text.trim(),
    options: (["A", "B", "C", "D"] as const).map((label) => {
      const opt = q.options.find((o) => o.label === label)!;
      const weights: Partial<Record<AbilityKey, number>> = {};
      if (VALID_ABILITY_KEYS.includes(opt.primary as AbilityKey)) {
        weights[opt.primary as AbilityKey] = 1.0;
      }
      if (opt.secondary && VALID_ABILITY_KEYS.includes(opt.secondary as AbilityKey)) {
        weights[opt.secondary as AbilityKey] = 0.5;
      }
      return { label, text: opt.text.trim(), poleValue: Math.round(opt.poleValue), weights };
    }),
  }));
}

export async function generateSJTQuestions(
  formData: Partial<JobFormData>,
): Promise<QuizQuestion[]> {
  const identity = formData.identity ?? "general_job_seeker";
  const identityLabel = identityLabelOf(identity);

  // 量表场景去精英化策略：应届走校园场景；社会求职者（不含确定 35-）一律走去精英化版本
  // — 老 young_unemployed 仍走原"主流职场"版；老 general_unemployed 与新 general_job_seeker
  // 都走"日常生活 + 服务场景"版本（最稳的画像，避免 LLM 假定用户在大厂工作）
  const contextHint =
    identity === "recent_grad"
      ? "场景偏学校、实习、兼职、社团、校园求职；可适度涉及标准职场术语"
      : identity === "young_unemployed"
        ? "场景偏主流职场 + 求职过渡 + 日常协作；避免特定行业黑话"
        : "**场景去精英化**：用日常生活 / 临时工作 / 服务场景 / 家庭 / 跨年龄沟通；**严禁**出现 KPI / 客户简报 / 项目 / 跨部门 / 汇报等精英职场词，可用「组里人」「管事的」「店里老板」代替";

  // prompt：输出文本 + 能力维度标签 + 4维偏好维度 + poleValue
  const systemPrompt = `你是职业测评专家。根据求职者背景生成 6 道情境判断题（SJT）。
**面向群体可能是长期求职、断续就业的人员，不全是精英职场背景**。

【严格输出格式（只输出 JSON，不得有任何其他内容）】
{"questions":[{"text":"情境描述40-80字","dimension":"workstyle","options":[{"label":"A","text":"行为描述20-45字","primary":"execution","poleValue":25},{"label":"B","text":"行为描述20-45字","primary":"communication","poleValue":72},{"label":"C","text":"行为描述20-45字","primary":"collaboration","poleValue":80},{"label":"D","text":"行为描述20-45字","primary":"data","poleValue":35}]},共6题]}

字段说明：
- dimension：这道题测哪个 4 维偏好，只能从以下 4 个中选：personality / workstyle / value / direction
  * personality = 性格底色（内敛 0 ↔ 外向 100）
  * workstyle   = 工作风格（独立 0 ↔ 协作 100）
  * value       = 价值驱动（稳定务实 0 ↔ 探索创新 100）
  * direction   = 适配方向（执行专注 0 ↔ 统筹引领 100）
- poleValue：0-100，该选项在 dimension 光谱上的位置（0=强左极，100=强右极）
- primary / secondary（可选）只能从以下 6 个能力维度选：
  communication / collaboration / execution / learning / data / stress

约束：
- 共 6 道题，每题恰好 4 个选项（A B C D）
- 6 道题的 dimension 合计：4 个维度**每个至少出现 1 次**，ideally 其中 2 个维度各出现 2 次
- 每题的 4 个选项 poleValue 要有**明显区分**（例如不能全在 60-70 之间），要覆盖 0-100 的分布
- secondary 可不填；如果填，必须和 primary 不同
- 措辞温和、不带审判感、不带焦虑或紧迫感
- 不出现 MBTI / 大五 / 霍兰德等专有名词`;

  const userPrompt = `求职者背景：
- 身份：${identityLabel}（${contextHint}）
- 学历：${formData.education ?? "未知"}
- 工作年限：${formData.workYears ?? "未知"}
- 目标岗位：${formData.targetPosition?.trim() || "未指定"}

生成 6 道情境判断题，输出合法 JSON。`;

  const result = await callWithFallback<LLMSimpleBank>({
    systemPrompt,
    userPrompt,
    // 主模型：astron-code-latest（讯飞 Coding Plan），无推理开销
    maxTokens: 2000,
    temperature: 0.7,
    timeoutMs: 30_000,
    validator: validateSimpleBank,
    context: "quiz/bank/SJT-generate",
  });

  return normalizeSimpleBank(result);
}
