import type { UserIdentity } from "./types";

export const USER_IDENTITY_OPTIONS: { value: UserIdentity; label: string; description: string }[] = [
  { value: "recent_grad", label: "离校未就业", description: "毕业后尚未找到第一份工作" },
  { value: "young_unemployed", label: "35岁以下失业青年", description: "35周岁以下，曾有工作经历，目前失业" },
  { value: "general_unemployed", label: "一般失业人员", description: "有工作经历，当前正在求职中" },
];

export const EDUCATION_OPTIONS = [
  { value: "junior_high", label: "初中及以下" },
  { value: "high_school", label: "高中/中专/技校" },
  { value: "junior_college", label: "高职/大专" },
  { value: "bachelor", label: "本科" },
  { value: "master_plus", label: "硕士及以上" },
];

export const WORK_YEARS_OPTIONS = [
  { value: "none", label: "无工作经验" },
  { value: "lt1", label: "1 年以内" },
  { value: "1to3", label: "1-3 年" },
  { value: "3to5", label: "3-5 年" },
  { value: "5to10", label: "5-10 年" },
  { value: "gt10", label: "10 年以上" },
];
