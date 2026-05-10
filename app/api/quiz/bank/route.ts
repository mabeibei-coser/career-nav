import { NextRequest, NextResponse } from "next/server";
import { loadQuizBank, sampleQuestions, validateBank } from "@/lib/quiz-bank";
import type { UserIdentity } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/quiz/bank
 * Body: { identity: UserIdentity }
 *
 * 根据用户身份过滤题库：
 *   recent_grad → 保留 context="all" 和 context="grad" 的题目
 *   young_unemployed / general_unemployed → 保留 context="all" 和 context="work" 的题目
 */
export async function POST(req: NextRequest) {
  try {
    let identity: UserIdentity | undefined;
    try {
      const body = await req.json();
      identity = body?.identity as UserIdentity | undefined;
    } catch {
      // body 解析失败时 identity 留 undefined，走默认过滤
    }

    const bank = loadQuizBank();
    validateBank(bank, 5);

    // 根据身份确定 context 过滤标签
    const contextFilter: string[] =
      identity === "recent_grad" ? ["all", "grad"] : ["all", "work"];

    const questions = sampleQuestions(bank, 2, contextFilter);
    return NextResponse.json(
      { questions, version: bank.version },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "quiz-bank load failed";
    console.error("[api/quiz/bank] load failed:", msg);
    return NextResponse.json({ errorMessage: msg }, { status: 503 });
  }
}

// 保留 GET 兜底（兼容老版本缓存请求）：直接走 all+work 默认过滤
export async function GET() {
  try {
    const bank = loadQuizBank();
    validateBank(bank, 5);
    const questions = sampleQuestions(bank, 2, ["all", "work"]);
    return NextResponse.json(
      { questions, version: bank.version },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "quiz-bank load failed";
    console.error("[api/quiz/bank] GET fallback failed:", msg);
    return NextResponse.json({ errorMessage: msg }, { status: 503 });
  }
}
