import type {
  Advice,
  JobFormData,
  Overview,
  Positioning,
  ReportData,
  ReportMeta,
  ReportSectionKey,
  ResumeDiagnosis,
  ScoringResult,
  Strength,
} from "@/lib/types";

// ① 总评：性格综述 + 四维雷达
export const MOCK_OVERVIEW: Overview = {
  personality: {
    type: "ISTJ · 可靠执行者",
    traits: ["专注", "务实", "细心", "可靠"],
    description:
      "你是一个倾向于先观察再行动的人，做事讲究稳妥与条理，不容易被情绪带偏。在熟悉的流程里你能稳定输出高质量成果，面试中展现的条理性会很加分；但遇到需要快速拍板或即兴发挥的场景，可能会显得犹豫偏慢。",
  },
  fourDimRadar: [
    { name: "性格底色", score: 70, conclusion: "倾向安静观察，表达较为含蓄" },
    { name: "工作风格", score: 65, conclusion: "条理清晰，执行稳健，节奏偏稳" },
    { name: "价值驱动", score: 75, conclusion: "在意稳定与成长，对意义感有要求" },
    { name: "适配方向", score: 60, conclusion: "信息处理耐心，压力承受中等" },
  ],
  summary:
    "整体来看，你属于「稳一点先做对、再做快」的类型：有耐心、有责任感，适合面向流程清晰、强调可靠性的岗位。短期建议把「主动表达」和「接受不完美的快节奏」作为练习方向，既能放大你的稳重优势，也能让你在团队里被更多人看见。",
};

// ② 优势发现：能力雷达 + 优势分析
export const MOCK_STRENGTH: Strength = {
  abilityRadar: [
    { name: "沟通表达", score: 70 },
    { name: "协作意识", score: 75 },
    { name: "执行落地", score: 80 },
    { name: "学习能力", score: 65 },
    { name: "信息处理", score: 60 },
    { name: "压力适应", score: 70 },
  ],
  strengths: [
    {
      title: "踏实可靠的执行力",
      detail:
        "你愿意把交代下来的事情做到位，遇到细节问题会主动核对而不是糊弄过去。这种「靠谱」在用人单位眼里是稀缺品，尤其是基层岗的带教 leader 普遍把这条排在第一位。",
    },
    {
      title: "团队里的协作润滑剂",
      detail:
        "你不太争抢，但也不甩锅，能让团队的进度自然往前走。在多部门协同的工作里，这种气质能减少不必要的摩擦，是后续承担更复杂职责的基础。",
    },
    {
      title: "对压力有较好的承受度",
      detail:
        "节奏紧的时候你能稳住情绪、按部就班完成，不会因为一时挫败就放弃。把这一点放在简历和面试里讲一两个具体例子，会非常加分。",
    },
  ],
  growth: [
    {
      title: "可以多主动表达想法",
      detail:
        "你在团队里偏倾听者的角色，但岗位升级常常需要「先开口」。建议从小场合练起：每周例会主动发言一次，把自己的判断说清楚，哪怕只是半句结论。",
    },
    {
      title: "信息处理可以更结构化",
      detail:
        "面对一堆资料时容易顺着读、缺少分类。下一步可以试着用「先分类、再总结」的方式整理材料（比如做岗位调研时按「行业 / 公司 / 岗位职责」建表），逐步形成自己的处理框架。",
    },
  ],
};

// ③ 职业定位：首选 + 次选岗位
export const MOCK_POSITIONING: Positioning = {
  primary: {
    position: "客户服务专员（金融机构）",
    matchScore: 85,
    reasoning:
      "客户服务专员是金融机构的一线窗口岗位，主要负责受理客户咨询、办理基础业务、处理投诉与售后跟进。该岗位流程规范、培训体系成熟，是金融行业最主要的入门通道之一，后续可向理财顾问、运营管理等方向发展。",
    industries: ["商业银行支行", "保险经代公司", "持牌消费金融"],
    culture: "稳定流程导向 / 重合规 / 师徒带教制",
    teamRole: "执行支持型",
    coreResponsibilities: [
      "受理客户来电与现场咨询",
      "解答产品条款与办理流程",
      "跟进工单确保问题闭环",
      "维护客户档案与数据更新",
      "配合完成满意度回访",
    ],
    coreCompetencies: [
      { name: "沟通表达", score: 75 },
      { name: "耐心服务", score: 80 },
      { name: "合规意识", score: 70 },
      { name: "学习能力", score: 65 },
    ],
    fitReason:
      "从专业背景看，你的学历方向与金融服务领域有较好的衔接基础，能帮助你更快理解业务术语和产品逻辑。从性格特质看，你在量表中展现出较高的耐心和稳重度（工作风格 65 分、压力适应 70 分），这恰恰是客服岗最核心的素质——在面对情绪激动的客户时能保持冷静、按流程处理。从能力维度看，你的执行落地能力突出（80 分），说明你能在流程明确的环境中高效完成任务，这与金融机构强调的合规与标准化高度匹配。此外，你的协作意识较强，善于配合团队节奏，适合金融机构中多部门联动的工作模式。",
  },
  secondary: {
    position: "行政与人事助理",
    matchScore: 75,
    reasoning:
      "行政人事助理是企业内部运转的支撑型岗位，日常涵盖考勤管理、入离职办理、办公行政协调等事务。该岗位需求稳定、学习曲线平缓，适合希望在企业内部积累经验的求职者，后续可向人力资源专员或行政主管方向发展。",
    industries: ["中小型科技公司", "本地民营企业总部", "外资企业上海办公室"],
    culture: "节奏适中 / 服务内部客户为主 / 重视细致与口碑",
    teamRole: "事务支持 + 信息中转",
    coreResponsibilities: [
      "办理入离职与社保手续",
      "整理人事档案与考勤表",
      "统筹办公采购与资产管理",
      "协助招聘与面试安排",
      "对接物业处理日常事务",
    ],
    coreCompetencies: [
      { name: "细节把控", score: 75 },
      { name: "多任务协调", score: 65 },
      { name: "沟通协作", score: 70 },
      { name: "信息处理", score: 60 },
    ],
    fitReason:
      "从工作风格看，你倾向于先把事情理清楚再执行，做事有条理、不容易遗漏细节，这与行政人事助理需要同时处理多条事务线、保证每件事不出差错的要求非常契合。从协作特质看，你的协作意识得分较高（75 分），说明你善于配合不同部门的需求，这在行政人事岗中尤为重要——你需要同时对接业务部门、财务、外部供应商等多方。从发展路径看，行政人事岗能让你快速了解一家公司的完整运作方式，积累的跨部门人脉和业务理解，未来无论转向HR专业线还是运营管理，都是扎实的起点。",
  },
};

// ④ 简历快诊：问题 + 建议
export const MOCK_RESUME_DIAGNOSIS: ResumeDiagnosis = {
  overallScore: 72,
  issues: [
    {
      title: "工作描述偏笼统",
      detail:
        "经历部分多是「负责 XX 工作」的概括式表达，看不出你具体做了什么、用了什么方法、最后什么效果。HR 在 30 秒筛选里很难抓到亮点。",
      priority: "high",
      quotedSnippet: "负责日常客户服务工作，处理客户咨询",
    },
    {
      title: "缺少量化成果",
      detail:
        "数字、范围、对比都很少。哪怕没有精确数据，也可以用「周均」「平均」「相比之前」这类表达，让经验更可信。",
      priority: "medium",
    },
    {
      title: "技能栈没有主次",
      detail:
        "技能区一长串工具罗列，看不出你对哪几样真正熟练。建议分「熟练 / 使用过 / 了解」三档，或者直接在最前面写出 3 个核心强项。",
      priority: "low",
    },
  ],
  suggestions: [
    {
      title: "加入数字让经验可信",
      detail:
        "把「负责客户咨询」改成「日均处理 30+ 客户咨询，常见问题一次性解决率约 80%」。即使是估算的范围也比纯描述更有冲击力。",
    },
    {
      title: "用 STAR 重写一段重点经历",
      detail:
        "挑你最想被看到的一段经历，按「背景 / 任务 / 我做了什么 / 结果」四步重写一遍。先重写一段，再用同样的模板套其他经历。",
    },
    {
      title: "顶部加 3 行自我定位",
      detail:
        "在简历最上方加一段 80 字以内的自我定位，写明「目标岗位 + 核心优势 + 一项具体能力」。让 HR 第一眼就知道你想做什么、能做什么。",
    },
  ],
};

// ⑤ 行动计划：最重要的三件事
export const MOCK_ADVICE: Advice = {
  topThree: [
    {
      title: "重写简历核心经历",
      detail:
        "把「负责 XX 工作」改成「做了什么 → 用了什么方法 → 取得什么结果」的 STAR 格式，先从最近的一段经历改起，控制在 3-5 行以内。",
      deadline: "本周内",
    },
    {
      title: "准备 90 秒结构化自我介绍",
      detail:
        "按「我是谁 → 我做过什么 → 我想做什么」的结构写稿，对着手机录 3 遍，每遍控制在 90 秒内，直到不卡壳。",
      deadline: "两周内",
    },
    {
      title: "投递 3-5 个目标岗位",
      detail:
        "在招聘平台筛选通勤 1 小时内、JD 写得具体的目标岗位，先投不纠结。同时记录每次投递的岗位和反馈，方便后续复盘调整方向。",
      deadline: "一个月内",
    },
  ],
};

// 元信息 mock：构造一份完整的 ReportMeta
const MOCK_FORM_DATA: JobFormData = {
  identity: "general_unemployed",
  targetPosition: "客户服务专员",
  education: "本科",
  workYears: "1-3 年",
  resumeText: "（mock 简历占位文本）",
  resumeFileName: "resume-sample.pdf",
};

const MOCK_SCORING: ScoringResult = {
  fourDim: [
    { dimension: "personality", name: "性格底色", score: 70 },
    { dimension: "workstyle", name: "工作风格", score: 65 },
    { dimension: "value", name: "价值驱动", score: 75 },
    { dimension: "direction", name: "适配方向", score: 60 },
  ],
  ability: [
    { key: "communication", name: "沟通表达", score: 70 },
    { key: "collaboration", name: "协作意识", score: 75 },
    { key: "execution", name: "执行落地", score: 80 },
    { key: "learning", name: "学习能力", score: 65 },
    { key: "data", name: "信息处理", score: 60 },
    { key: "stress", name: "压力适应", score: 70 },
  ],
};

export const MOCK_REPORT_META: ReportMeta = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  formData: MOCK_FORM_DATA,
  scoring: MOCK_SCORING,
  hasResume: true,
  interviewQ1Q2: {
    Q1: "我对客服岗最感兴趣，因为能直接帮到人，也想从基础业务学起。",
    Q2: "上份兼职里我每天都和客户沟通，慢慢摸出怎么把复杂规则讲清楚的方法。",
  },
};

// 完整 ReportData mock（无 LLM 时全链路兜底）
export const MOCK_REPORT_DATA: ReportData = {
  meta: MOCK_REPORT_META,
  overview: MOCK_OVERVIEW,
  strength: MOCK_STRENGTH,
  positioning: MOCK_POSITIONING,
  resumeDiagnosis: MOCK_RESUME_DIAGNOSIS,
  advice: MOCK_ADVICE,
};

// 工具函数：按 section key 取 mock
export function getMockBySection(key: ReportSectionKey) {
  switch (key) {
    case "overview":
      return MOCK_OVERVIEW;
    case "strength":
      return MOCK_STRENGTH;
    case "positioning":
      return MOCK_POSITIONING;
    case "resumeDiagnosis":
      return MOCK_RESUME_DIAGNOSIS;
    case "advice":
      return MOCK_ADVICE;
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}
