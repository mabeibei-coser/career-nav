// 兜底模型：讯飞标准 API（xop35qwen2b）
// 未配 IFLYTEK_API_KEY 时为 null；调用方必须先检查再使用。
import OpenAI from "openai";

export const IFLYTEK_MODEL = process.env.IFLYTEK_MODEL ?? "xop35qwen2b";

const apiKey = process.env.IFLYTEK_API_KEY;
const baseURL =
  process.env.IFLYTEK_BASE_URL ??
  "https://maas-api.cn-huabei-1.xf-yun.com/v2";

const iflytek = apiKey ? new OpenAI({ apiKey, baseURL }) : null;

export default iflytek;
export const hasIflytek = !!iflytek;
