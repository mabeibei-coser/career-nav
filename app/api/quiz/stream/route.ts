import { NextRequest } from "next/server";
import { getDeepseekClient, DEEPSEEK_MODEL } from "@/lib/deepseek";
import iflytek, { IFLYTEK_MODEL } from "@/lib/iflytek";
import {
  FALLBACK_QUESTIONS,
  JSON_CONSTRAINT_PREFIX,
  buildQuizSystemPrompt,
  buildQuizUserPrompt,
  normalizeQuestion,
  ProgressiveQuestionParser,
} from "@/lib/quiz-stream";
import { stripReasoning, extractJson, tryFixAndParse } from "@/lib/report-shared";
import type { JobFormData, QuizQuestion } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const TOTAL_QUESTIONS = 8;
// DeepSeek 流式 40s 超时 → 讯飞非流式补齐剩余 → FALLBACK 兜底
const STREAM_TIMEOUT_MS = 40_000;

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
        send(JSON.stringify({ type: "question", question: q }));
        emittedCount++;
      };

      try {
        await streamFromDeepseek(formData, emitQuestion);
      } catch (dsErr) {
        const msg = dsErr instanceof Error ? dsErr.message : String(dsErr);
        console.warn(`[quiz/stream] DeepSeek failed after ${emittedCount} questions:`, msg);
      }

      // DeepSeek 没出满 8 题 → 讯飞补齐剩余题目
      if (iflytek && emittedCount < TOTAL_QUESTIONS) {
        try {
          const remaining = TOTAL_QUESTIONS - emittedCount;
          console.info(`[quiz/stream] 讯飞补位: 还需 ${remaining} 题`);
          const questions = await generateFromIflytek(formData);
          // 跳过前 emittedCount 题（避免与已生成的重复），取剩余数量
          for (const q of questions.slice(emittedCount, TOTAL_QUESTIONS)) {
            emitQuestion(q);
          }
        } catch (ifErr) {
          const ifMsg = ifErr instanceof Error ? ifErr.message : String(ifErr);
          console.warn("[quiz/stream] iFlytek fallback also failed:", ifMsg);
        }
      }

      // 无论 AI 生成了多少题，都顶满 TOTAL_QUESTIONS
      // emittedCount=0 → 全部用 FALLBACK；emittedCount=3 → 补 SJT-04..08
      if (emittedCount < TOTAL_QUESTIONS) {
        console.info(`[quiz/stream] 补位 fallback: 已生成 ${emittedCount} 题，补 ${TOTAL_QUESTIONS - emittedCount} 题`);
        for (const q of FALLBACK_QUESTIONS.slice(emittedCount)) {
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

async function streamFromDeepseek(
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
        temperature: 1.0,
        max_tokens: 4000,
        // 不启用 response_format：astron-code-latest 在此模式下输出异常
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
      throw new Error(`Only ${parser.getEmittedCount()} questions parsed from stream`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function generateFromIflytek(formData: JobFormData): Promise<QuizQuestion[]> {
  if (!iflytek) throw new Error("iFlytek not configured");

  const controller = new AbortController();
  // 给讯飞足够时间生成剩余题目（DeepSeek 超时后讯飞是主力补位）
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await iflytek.chat.completions.create(
      {
        model: IFLYTEK_MODEL,
        messages: [
          { role: "system", content: JSON_CONSTRAINT_PREFIX + buildQuizSystemPrompt() },
          { role: "user", content: buildQuizUserPrompt(formData) },
        ],
        temperature: 1.0,
        max_tokens: 4000,
        // 不启用 response_format，由 prompt 约束兜底
      },
      { signal: controller.signal },
    );

    const rawContent = response.choices[0]?.message?.content || "";
    const cleaned = stripReasoning(rawContent);
    const jsonStr = extractJson(cleaned);
    const data = tryFixAndParse(jsonStr) as { questions?: { text: string; options: { label: string; text: string; primary?: string; secondary?: string }[] }[] };

    if (!data?.questions || !Array.isArray(data.questions)) {
      throw new Error("Invalid iFlytek response structure");
    }

    return data.questions
      .slice(0, TOTAL_QUESTIONS)
      .map((q, i) => normalizeQuestion(q, i));
  } finally {
    clearTimeout(timer);
  }
}

function mockSSEResponse(): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      for (const q of FALLBACK_QUESTIONS) {
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
