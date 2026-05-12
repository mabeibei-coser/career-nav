import type { UserIdentity } from "./types";

export const USER_IDENTITY_OPTIONS: { value: UserIdentity; label: string; description: string }[] = [
  { value: "recent_grad", label: "应届毕业生", description: "毕业后尚未找到第一份工作" },
  { value: "young_unemployed", label: "35岁以下求职者", description: "35周岁以下，有工作经历，正在求职中" },
  { value: "general_unemployed", label: "35岁以上求职者", description: "35周岁及以上，有工作经历，正在求职中" },
];

export const EDUCATION_OPTIONS = [
  { value: "junior_high", label: "初中及以下" },
  { value: "high_school", label: "高中/中专/技校" },
  { value: "junior_college", label: "高职/大专" },
  { value: "bachelor", label: "本科" },
  { value: "master_plus", label: "硕士及以上" },
];

export const WORK_YEARS_OPTIONS = [
  { value: "lt1", label: "0-1年（含）" },
  { value: "1to3", label: "1-3年（含）" },
  { value: "3to10", label: "3-10年（含）" },
  { value: "gt10", label: "10年以上" },
];
