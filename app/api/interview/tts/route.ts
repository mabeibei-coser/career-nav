import { NextRequest, NextResponse } from "next/server";
import { synthesizeTTS } from "@/lib/volc-tts";

export const runtime = "nodejs";
export const maxDuration = 15;

// POST /api/interview/tts
// Input:  { text: string }
// Output: { audioBase64: string }   — 空串表示 TTS 失败（前端静默降级）
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text: unknown = body?.text;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ audioBase64: "" });
    }

    const audioBase64 = await synthesizeTTS(text.trim());
    return NextResponse.json({ audioBase64 });
  } catch (err) {
    console.error("[interview/tts] error:", err);
    return NextResponse.json({ audioBase64: "" });
  }
}
