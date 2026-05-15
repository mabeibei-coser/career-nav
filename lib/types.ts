// ========== 表单输入类型 ==========

export type UserIdentity = "recent_grad" | "young_unemployed" | "general_unemployed";

export interface JobFormData {
  identity: UserIdentity;
  targetPosition: string;
  education: string;
  workYears: string;
  resumeText?: string;
  resumeFileName?: string;
}

// ========== 量表测评类型 ==========

export type QuizDimension = "personality" | "workstyle" | "value" | "direction";

export const QUIZ_DIMENSION_NAMES: Record<QuizDimension, string> = {
  personality: "性格底色",
  workstyle: "工作风格",
  value: "价值驱动",
  direction: "适配方向",
};

export type AbilityKey =
  | "communication"
  | "collaboration"
  | "execution"
  | "learning"
  | "data"
  | "stress";

export const ABILITY_NAMES: Record<AbilityKey, string> = {
  communication: "沟通表达",
  collaboration: "协作意识",
  execution: "执行落地",
  learning: "学习能力",
  data: "信息处理",
  stress: "压力适应",
};

// 情境判断题（SJT）选项
export interface QuizOption {
  label: "A" | "B" | "C" | "D";
  text: string;
  /**
   * 主标签：该选项在所属维度（QuizQuestion.dimension）光谱上的位置。
   * 0 = 强左极，100 = 强右极，50 = 中性。
   * 例：性格底色维度（内敛↔外向），poleValue=20 = 偏内敛，poleValue=80 = 偏外向。
   * 4 维评估的 score 由所属维度的 2 题 poleValue 平均得来。
   */
  poleValue?: number;
  /**
   * 副标签：该选项体现的 6 能力维度权重（稀疏矩阵，每选项覆盖 1-2 个能力）。
   * 给 positioning 模块的「核心能力匹配」雷达图用。值域 0-1。
   */
  weights: Partial<Record<AbilityKey, number>>;
}

// 情境判断题
export interface QuizQuestion {
  id: string;
  /**
   * 这道题测哪个 4 维偏好维度（personality/workstyle/value/direction）。
   * 8 题 = 4 维 × 2 题/维。旧数据可能没有此字段，scoring 会 fallback 到 proxy 推导。
   */
  dimension?: QuizDimension;
  text: string; // 情境描述
  options: QuizOption[]; // 固定 4 个选项（A/B/C/D）
}

export interface QuizBank {
  version: string;
  fixedQuestions: QuizQuestion[]; // 固定题目（SJT-01 = Q1）
}

export interface QuizAnswer {
  questionId: string;
  selectedLabel: "A" | "B" | "C" | "D"; // 用户选择的选项标签
}

export interface DimensionScore {
  dimension: QuizDimension;
  name: string;
  score: number;
}

export interface AbilityScore {
  key: AbilityKey;
  name: string;
  score: number;
}

export interface ScoringResult {
  fourDim: DimensionScore[];
  ability: AbilityScore[];
}

// ========== 访谈类型 ==========

export type InterviewQuestionId = "Q1" | "Q2" | "Q3" | "Q4";

export interface InterviewQuestion {
  id: InterviewQuestionId;
  text: string;
  source: "dynamic" | "fixed";
  audioBase64?: string; // Volcano TTS base64 MP3（可能为空，前端静默降级）
}

export interface InterviewAnswer {
  questionId: InterviewQuestionId;
  text: string;
  inputMethod: "voice" | "text";
  audioDurationSec?: number;
}

export interface InterviewQ1Q2 {
  Q1?: string;
  Q2?: string;
}

// ========== 报告类型 ==========

export type ReportSectionKey =
  | "overview"
  | "strength"
  | "positioning"
  | "resumeDiagnosis"
  | "advice";

export interface ReportMeta {
  generatedAt: string;
  formData: JobFormData;
  scoring: ScoringResult;
  hasResume: boolean;
  interviewQ1Q2: InterviewQ1Q2;
}

// ① 总评：性格综述 + 四维雷达
export interface Overview {
  personality: {
    type: string;
    traits: string[];
    description: string;
  };
  fourDimRadar: {
    name: string;
    score: number;
    conclusion?: string;  // LLM 生成的维度文字结论（30 字以内）
  }[];
  summary: string;
}

// ② 优势发现：能力雷达 + 优势分析
export interface Strength {
  abilityRadar: {
    name: string;
    score: number;
  }[];
  strengths: {
    title: string;
    detail: string;
  }[];
  growth: {
    title: string;
    detail: string;
  }[];
}

// ③ 职业定位：首选 + 次选岗位
export interface PositionRecommendation {
  position: string;
  matchScore: number;
  reasoning: string;
  industries: string[];
  culture: string;
  teamRole: string;
  coreResponsibilities?: string[];                              // 核心职责（5 条，每条 10-15 字）
  coreCompetencies?: { name: string; score: number }[];       // 核心能力要求（4-5 项，score 0-100）
  fitReason?: string;                                          // 为什么适合你（30-60 字）
  specialNote?: string;                                        // 特别注意：具体的自我提升建议（40-80 字）
}

export interface Positioning {
  primary: PositionRecommendation;
  secondary: PositionRecommendation;
}

// ④ 简历快诊：问题 + 建议
export interface ResumeDiagnosis {
  overallScore: number;
  issues: {
    title: string;
    detail: string;
    priority: "high" | "medium" | "low";
    quotedSnippet?: string;
    revisionExample?: string;  // 修订示例：针对本条问题的 1 个具体改法（40-80 字）
  }[];
  suggestions: {
    title: string;
    detail: string;
  }[];
}

// ⑤ 行动计划：最重要的三件事 + 时间点
export interface Advice {
  topThree: {
    title: string;
    detail: string;
    deadline: string;
  }[];
}

export interface ReportData {
  meta: ReportMeta;
  overview: Overview;
  strength: Strength;
  positioning: Positioning;
  resumeDiagnosis: ResumeDiagnosis | null;
  advice: Advice;
}

// ========== Section 调度类型（前端并发使用） ==========

export interface SectionProgress {
  key: ReportSectionKey;
  status: "pending" | "running" | "done" | "error" | "fallback";
  attempt: number;
  errorMessage?: string;
}
