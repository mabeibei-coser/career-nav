import { getDb } from "./db";

// 服务使用协议 / 隐私政策：admin-hub 后台编辑、career-nav 前台只读。
// 与 ATA100 / ASG100 同结构。表 schema 见 lib/db.ts。
export const LEGAL_TYPES = ["terms", "privacy"] as const;
export type LegalType = (typeof LEGAL_TYPES)[number];

export interface LegalRow {
  type: LegalType;
  title: string;
  content: string;
  updated_at: number;
}

export function getLegal(type: string): LegalRow | null {
  if (!LEGAL_TYPES.includes(type as LegalType)) return null;
  const row = getDb()
    .prepare(
      "SELECT type, title, content, updated_at FROM legal_documents WHERE type = ?"
    )
    .get(type) as LegalRow | undefined;
  return row ?? null;
}
