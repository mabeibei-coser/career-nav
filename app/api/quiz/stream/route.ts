import { NextRequest } from "next/server";
import { getDeepseekClient, DEEPSEEK_MODEL } from "@/lib/deepseek";
import iflytek, { IFLYTEK_MODEL } from "@/lib/iflytek";
import {
  getFallbackQuestionsForIdentity,
  JSON_CONSTRAINT_PREFIX,
  buildQuizSystemPrompt,
  buildQuizUserPrompt,
  ProgressiveQuestionParser,
} from "@/lib/quiz-stream";
import type { JobFormData, QuizQuestion } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const TOTAL_QUESTIONS = 8;
// 讯飞 Coding（主模型）流式 55s 超时 → 讯飞通用（兜底模型）非流式补齐 → 静态题库兜底
// maxDuration 120s：55s 主模型 + 45s 兜底模型 + 余量
const STREAM_TIMEOUT_MS = 55_000;

export async function POST(req: NextRequest) {
  let formData: JobFormData;
  try {
    const body = await req.json();
    formData = body?.formData;
    if (!formData?.identity) throw new Error("missing identity");
  } catch {
    return new Response(
      JSON.stringify({ error: "formData 缺失" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (process.env.E2E_MOCK_MODE === "true") {
    return mockSSEResponse();
  }

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch { /* controller already closed */ }
      };

      let emittedCount = 0;

      const emitQuestion = (q: QuizQuestion) => {
        emittedCount++;
        // 统一重编号：主模型 / 讯飞补位 / 静态兜底的题按 emit 顺序连续编号，id 不冲突
        const renumbered = { ...q, id: `SJT-${String(emittedCount).padStart(2, "0")}` };
        send(JSON.stringify({ type: "question", question: renumbered }));
      };

      // 第一轮：讯飞 Coding（主模型）流式生成
      try {
        await streamFromPrimary(formData, emitQuestion);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[quiz/stream] 主模型流式超时/失败，已出 ${emittedCount} 题:`, msg);
      }

      // 第二轮：主模型没出满 → 讯飞通用模型（兜底）流式补缺口
      if (iflytek && emittedCount < TOTAL_QUESTIONS) {
        try {
          const remaining = TOTAL_QUESTIONS - emittedCount;
          console.info(`[quiz/stream] 讯飞通用模型补位: 还需 ${remaining} 题`);
          await streamFillRemaining(formData, remaining, emitQuestion);
          console.info(`[quiz/stream] 讯飞补位后已出 ${emittedCount} 题`);
        } catch (ifErr) {
          const ifMsg = ifErr instanceof Error ? ifErr.message : String(ifErr);
          console.warn("[quiz/stream] 讯飞通用模型也失败:", ifMsg);
        }
      }

      // 第三轮：两个模型都没出满 → 静态题库兜底（按身份选去精英化版或通用版）
      if (emittedCount < TOTAL_QUESTIONS) {
        console.info(`[quiz/stream] 静态兜底: 已生成 ${emittedCount} 题，补 ${TOTAL_QUESTIONS - emittedCount} 题`);
        const fallback = getFallbackQuestionsForIdentity(formData.identity);
        for (const q of fallback.slice(emittedCount)) {
          emitQuestion(q);
        }
      }

      send("[DONE]");
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * 讯飞 Coding Plan（主模型）流式生成 8 题。
 * env 变量沿用 DEEPSEEK_* 命名，实际连接 maas-coding-api.cn-huabei-1.xf-yun.com。
 */
async function streamFromPrimary(
  formData: JobFormData,
  emitQuestion: (q: QuizQuestion) => void,
): Promise<void> {
  const client = getDeepseekClient();
  const parser = new ProgressiveQuestionParser();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  try {
    const stream = await client.chat.completions.create(
      {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: JSON_CONSTRAINT_PREFIX + buildQuizSystemPrompt() },
          { role: "user", content: buildQuizUserPrompt(formData) },
        ],
        temperature: 0.7,
        max_tokens: 4000,
        stream: true,
      },
      { signal: controller.signal },
    );

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (!delta) continue;

      const newQuestions = parser.push(delta);
      for (const q of newQuestions) emitQuestion(q);

      if (parser.getEmittedCount() >= TOTAL_QUESTIONS) break;
    }

    if (parser.getEmittedCount() < TOTAL_QUESTIONS) {
      throw new Error(`主模型只生成了 ${parser.getEmittedCount()} 题`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 讯飞通用模型（兜底）流式补缺口。
 * 主模型超时后调用，**只生成 needCount 道**（输出短 → 快、JSON 更不易崩、不会被 token 截断），
 * 复用 ProgressiveQuestionParser 的逐题解析 + 容错（label 不匹配按位置兜底 + emit 守卫）。
 */
async function streamFillRemaining(
  formData: JobFormData,
  needCount: number,
  emitQuestion: (q: QuizQuestion) => void,
): Promise<void> {
  if (!iflytek) throw new Error("讯飞通用模型未配置");

  const parser = new ProgressiveQuestionParser();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const stream = await iflytek.chat.completions.create(
      {
        model: IFLYTEK_MODEL,
        messages: [
          { role: "system", content: JSON_CONSTRAINT_PREFIX + buildQuizSystemPrompt(needCount) },
          { role: "user", content: buildQuizUserPrompt(formData, needCount) },
        ],
        temperature: 0.7,
        max_tokens: 4000,
        stream: true,
      },
      { signal: controller.signal },
    );

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (!delta) continue;

      const newQuestions = parser.push(delta);
      for (const q of newQuestions) emitQuestion(q);

      if (parser.getEmittedCount() >= needCount) break;
    }
  } finally {
    clearTimeout(timer);
  }
}

function mockSSEResponse(): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      // E2E mock 默认用通用版（test 不区分身份）
      for (const q of getFallbackQuestionsForIdentity(undefined)) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "question", question: q })}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
    },
  });
}
