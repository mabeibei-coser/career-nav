import { NextResponse } from "next/server";
import { getLegal, LEGAL_TYPES, type LegalType } from "@/lib/legal";

export const runtime = "nodejs";

const FALLBACK_TITLE: Record<LegalType, string> = {
  terms: "服务使用协议",
  privacy: "隐私政策",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  const { type } = await params;
  if (!LEGAL_TYPES.includes(type as LegalType)) {
    return NextResponse.json({ error: "未知协议类型" }, { status: 400 });
  }
  const row = getLegal(type);
  if (!row) {
    return NextResponse.json({
      type,
      title: FALLBACK_TITLE[type as LegalType],
      content: "",
      updatedAt: 0,
    });
  }
  return NextResponse.json({
    type: row.type,
    title: row.title || FALLBACK_TITLE[row.type],
    content: row.content,
    updatedAt: row.updated_at,
  });
}
