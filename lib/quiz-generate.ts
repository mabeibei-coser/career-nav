/**
 * SJT Q2-Q8 生成（LLM 调用 + 兜底题）
 * 由 /api/quiz/bank/generated 和旧 /api/quiz/bank 共享
 */
import { callWithFallback } from "@/lib/report-shared";
import type { JobFormData, QuizQuestion, AbilityKey } from "@/lib/types";

// ===== 7 道兜底 SJT 题（LLM 失败 / E2E Mock 时使用）=====
export const FALLBACK_GENERATED: QuizQuestion[] = [
  {
    id: "SJT-02",
    text: "你被要求独自向一个从未接触过该项目的客户做简报，时间只有 15 分钟。你会怎么准备？",
    options: [
      { label: "A", text: "收集所有项目资料，每个细节都准备好，宁可材料太多", weights: { data: 0.8, execution: 0.5 } },
      { label: "B", text: "先弄清楚客户最关心的 2-3 个问题，专注把这几点说清楚", weights: { communication: 1.0, execution: 0.6 } },
      { label: "C", text: "找项目组同事帮忙补充我不熟悉的部分，合作准备", weights: { collaboration: 0.9, communication: 0.5 } },
      { label: "D", text: "提前预演一遍，计时，确保 15 分钟内能把核心讲完", weights: { execution: 1.0, stress: 0.4 } },
    ],
  },
  {
    id: "SJT-03",
    text: "手头同时有三项任务，截止日期都在本周。你会怎么安排？",
    options: [
      { label: "A", text: "按紧急程度排序，先做最急的，做完一项再做下一项", weights: { execution: 1.0, stress: 0.5 } },
      { label: "B", text: "估算每项工作量，给每项分配时间块，交叉推进", weights: { execution: 0.9, data: 0.7 } },
      { label: "C", text: "问一下各方哪项最优先，按他们的期待来安排顺序", weights: { communication: 0.9, collaboration: 0.6 } },
      { label: "D", text: "先把能快速完成的做掉，建立节奏，再处理复杂的", weights: { execution: 0.8, learning: 0.4 } },
    ],
  },
  {
    id: "SJT-04",
    text: "工作中要求你用一个完全没用过的新工具，并在三天内产出结果。你会怎么做？",
    options: [
      { label: "A", text: "直接动手试，边用边看官方文档，出错再查", weights: { learning: 1.0, execution: 0.6 } },
      { label: "B", text: "先花一两个小时系统看教程，搞清楚基本逻辑再开始", weights: { learning: 0.9, data: 0.6 } },
      { label: "C", text: "找用过这个工具的人请教，让他们帮我快速上手", weights: { collaboration: 1.0, communication: 0.6 } },
      { label: "D", text: "如果来不及，提前说明风险并建议用熟悉的方案替代", weights: { communication: 0.8, stress: 0.5 } },
    ],
  },
  {
    id: "SJT-05",
    text: "你正在全力推进一项工作时，上级突然说要把截止日期提前两天。你的第一反应是什么？",
    options: [
      { label: "A", text: "立刻重新评估任务，看哪些可以简化，保证提前交付", weights: { execution: 1.0, stress: 0.6 } },
      { label: "B", text: "告诉上级现在的进展和风险，一起商量什么可以提前交付", weights: { communication: 1.0, collaboration: 0.5 } },
      { label: "C", text: "加班加点，想办法在新截止日前完成，不让上级失望", weights: { execution: 0.8, stress: 0.7 } },
      { label: "D", text: "先冷静下来，想清楚哪部分最核心，集中精力保核心先出", weights: { stress: 1.0, data: 0.5 } },
    ],
  },
  {
    id: "SJT-06",
    text: "你认为某个常用的做事方法效率很低，有更好的方案，但团队一直在用旧方法。你会怎么做？",
    options: [
      { label: "A", text: "默默按旧方法做，在自己权限内小范围测试新方案", weights: { execution: 0.8, learning: 0.6 } },
      { label: "B", text: "找合适时机向负责人提出来，展示新方案的具体好处", weights: { communication: 1.0, execution: 0.5 } },
      { label: "C", text: "先和几个同事聊，看他们是否也有同感，再集体提出", weights: { collaboration: 1.0, communication: 0.7 } },
      { label: "D", text: "研究一下为什么用旧方法，弄清楚背后原因再决定要不要提", weights: { data: 0.9, learning: 0.7 } },
    ],
  },
  {
    id: "SJT-07",
    text: "你负责整理一份有大量数据的分析报告，数据来源混乱、格式各异。你会怎么处理？",
    options: [
      { label: "A", text: "先把所有数据汇总进来，统一格式，再逐步分析", weights: { data: 1.0, execution: 0.6 } },
      { label: "B", text: "先弄清楚报告的核心问题，只收集与核心问题相关的数据", weights: { data: 0.8, communication: 0.5 } },
      { label: "C", text: "找数据来源的负责人沟通，请他们统一格式再给我", weights: { collaboration: 0.9, communication: 0.7 } },
      { label: "D", text: "搜索有没有现成工具或模板可以帮助快速整理这类数据", weights: { learning: 1.0, data: 0.5 } },
    ],
  },
  {
    id: "SJT-08",
    text: "你在一次团队复盘会上，发现你的工作方式受到了一些批评。你通常会怎么反应？",
    options: [
      { label: "A", text: "认真听，问清楚具体哪里有问题，下次做调整", weights: { learning: 1.0, communication: 0.6 } },
      { label: "B", text: "解释一下当时的考虑，让大家理解为什么这么做", weights: { communication: 0.9, stress: 0.4 } },
      { label: "C", text: "会有些情绪，但事后冷静下来会去想批评是否有道理", weights: { stress: 0.9, learning: 0.5 } },
      { label: "D", text: "和提出批评的人单独聊，进一步了解他们的想法", weights: { collaboration: 0.9, communication: 0.7 } },
    ],
  },
];

const VALID_ABILITY_KEYS: AbilityKey[] = [
  "communication", "collaboration", "execution", "learning", "data", "stress",
];

interface LLMGeneratedBank {
  questions: {
    id: string;
    text: string;
    options: { label: string; text: string; weights: Record<string, number> }[];
  }[];
}

function validateGeneratedQuestions(data: LLMGeneratedBank): string | null {
  if (!data || !Array.isArray(data.questions)) return "questions 字段缺失";
  if (data.questions.length !== 7)
    return `questions 长度应为 7，实际 ${data.questions.length}`;
  for (let i = 0; i < 7; i++) {
    const q = data.questions[i];
    if (!q || typeof q.text !== "string" || q.text.trim().length < 10)
      return `questions[${i}].text 无效`;
    if (!Array.isArray(q.options) || q.options.length !== 4)
      return `questions[${i}].options 必须有 4 个选项，实际 ${q.options?.length}`;
    const labels = new Set(["A", "B", "C", "D"]);
    for (const opt of q.options) {
      if (!labels.has(opt.label)) return `questions[${i}] 选项 label 非法: ${opt.label}`;
      if (typeof opt.text !== "string" || opt.text.trim().length < 5)
        return `questions[${i}] 选项 ${opt.label} text 过短`;
      if (typeof opt.weights !== "object" || opt.weights === null)
        return `questions[${i}] 选项 ${opt.label} weights 缺失`;
      for (const [k, v] of Object.entries(opt.weights)) {
        if (!VALID_ABILITY_KEYS.includes(k as AbilityKey))
          return `questions[${i}] 未知 ability key: ${k}`;
        if (typeof v !== "number" || v < 0 || v > 1)
          return `questions[${i}].weights.${k}=${v} 超出 [0,1]`;
      }
    }
  }
  return null;
}

function normalizeGeneratedQuestions(data: LLMGeneratedBank): QuizQuestion[] {
  return data.questions.map((q, i) => ({
    id: `SJT-0${i + 2}`, // SJT-02 to SJT-08
    text: q.text.trim(),
    options: (["A", "B", "C", "D"] as const).map((label) => {
      const opt = q.options.find((o) => o.label === label)!;
      const safeWeights: Partial<Record<AbilityKey, number>> = {};
      for (const k of VALID_ABILITY_KEYS) {
        const v = opt.weights[k];
        if (typeof v === "number" && v > 0) safeWeights[k] = v;
      }
      return { label, text: opt.text.trim(), weights: safeWeights };
    }),
  }));
}

export async function generateSJTQuestions(
  formData: Partial<JobFormData>,
): Promise<QuizQuestion[]> {
  const identity = formData.identity ?? "general_unemployed";
  const identityLabel =
    identity === "recent_grad"
      ? "离校未就业"
      : identity === "young_unemployed"
        ? "35岁以下失业青年"
        : "一般失业人员";

  const contextHint =
    identity === "recent_grad"
      ? "场景可以是学校小组项目、实习、兼职、社团活动、校园求职等"
      : "场景应为职场情境，如团队协作、任务交接、向上管理、处理数据等";

  const systemPrompt = `你是职业测评专家，设计情境判断题（SJT）。

任务：根据求职者背景生成 7 道职场情境判断题（id: SJT-02 到 SJT-08），每题 4 个选项（A/B/C/D）。

7 道题需要覆盖全部 6 个能力维度（每个维度至少在 2 道题中作为主要权重出现）：
- communication（沟通表达）
- collaboration（协作意识）
- execution（执行落地）
- learning（学习能力）
- data（信息处理）
- stress（压力适应）

【每道题要求】
- 情境描述：具体真实，40-80 字，描述明确的职场（或相关）情境
- 4 个选项（A/B/C/D）：每个 20-45 字，描述真实可能的行为，无评判感
- 选项权重（weights）：每个选项只写 1-2 个能力 key，权重值 0.4-1.0，可简单用 0.5/0.8/1.0
- 4 个选项合计覆盖至少 3 个不同能力维度

【输出 JSON 格式（严格遵守，不得有任何 JSON 之外的内容）】
{"questions":[{"id":"SJT-02","text":"...","options":[{"label":"A","text":"...","weights":{"communication":0.8}},{"label":"B","text":"...","weights":{"execution":1.0,"learning":0.4}},{"label":"C","text":"...","weights":{"collaboration":0.9}},{"label":"D","text":"...","weights":{"data":0.7,"stress":0.5}}]},/* 共7题 */]}`;

  const userPrompt = `求职者背景：
- 身份：${identityLabel}
- 学历：${formData.education ?? "未知"}
- 工作年限：${formData.workYears ?? "未知"}
- 目标岗位：${formData.targetPosition?.trim() || "未指定"}

请根据上述背景生成 7 道情境判断题（SJT-02 至 SJT-08）。
要求：
1. ${contextHint}
2. 7 道题覆盖全部 6 个能力维度（communication/collaboration/execution/learning/data/stress）
3. 输出合法 JSON（包含 questions 数组，共 7 题，每题 4 个选项 A-D）`;

  const result = await callWithFallback<LLMGeneratedBank>({
    systemPrompt,
    userPrompt,
    maxTokens: 3000,
    temperature: 0.7,
    timeoutMs: 25_000,
    validator: validateGeneratedQuestions,
    context: "quiz/bank/SJT-generate",
  });

  return normalizeGeneratedQuestions(result);
}
