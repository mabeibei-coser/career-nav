// 主模型：讯飞 Coding Plan（astron-code-latest）
// 兼容 OpenAI SDK。env var 沿用 DEEPSEEK_* 命名，值已切换到讯飞 Coding API。
// json_object 模式要求 prompt 内含 "json" 字符串（小写也可），否则返回 400。
import OpenAI from "openai";

let cachedClient: OpenAI | null = null;

export function getDeepseekClient(): OpenAI {
  if (cachedClient) return cachedClient;
  cachedClient = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY ?? "missing",
    baseURL:
      process.env.DEEPSEEK_BASE_URL ??
      "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2",
  });
  return cachedClient;
}

export const DEEPSEEK_MODEL =
  process.env.DEEPSEEK_MODEL ?? "astron-code-latest";

// Back-compat default export using a Proxy so existing `client.chat.completions...` paths still work.
const clientProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      // @ts-expect-error dynamic delegation
      return getDeepseekClient()[prop];
    },
  }
) as OpenAI;

export default clientProxy;
