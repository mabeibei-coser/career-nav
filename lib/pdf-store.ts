/**
 * PDF 文件存储（磁盘持久化）
 * ————————————
 * 生成后写入 data/pdfs/{id}.pdf + {id}.json（元数据），
 * 下载时直接读文件流返回，不依赖内存 token / job 缓存。
 *
 * 自动清理 24 小时前的旧文件。
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ReportData } from "@/lib/types";

const PDF_DIR =
  process.env.PDF_STORAGE_DIR ||
  path.join(process.cwd(), "data", "pdfs");

// 确保目录存在
try {
  fs.mkdirSync(PDF_DIR, { recursive: true });
} catch {
  /* 目录已存在 */
}

function todayYYYYMMDD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function filenameFor(reportData: ReportData | null): string {
  const position = reportData?.meta?.formData?.targetPosition ?? "报告";
  return `职业导航报告_${position}_${todayYYYYMMDD()}.pdf`;
}

interface PdfMeta {
  filename: string;
  createdAt: number;
}

/** 保存 PDF 到磁盘，返回 pdfId */
export function savePdf(buffer: Buffer, reportData: ReportData): string {
  const id = randomUUID();
  const filename = filenameFor(reportData);
  fs.writeFileSync(path.join(PDF_DIR, `${id}.pdf`), buffer);
  fs.writeFileSync(
    path.join(PDF_DIR, `${id}.json`),
    JSON.stringify({ filename, createdAt: Date.now() } satisfies PdfMeta)
  );
  return id;
}

/** 从磁盘读取 PDF，返回 buffer + 文件名 */
export function getPdf(id: string): { buffer: Buffer; filename: string } | null {
  // 防路径遍历
  if (!/^[a-f0-9-]+$/.test(id)) return null;

  const pdfPath = path.join(PDF_DIR, `${id}.pdf`);
  if (!fs.existsSync(pdfPath)) return null;

  const buffer = fs.readFileSync(pdfPath);
  let filename = "职业导航报告.pdf";
  try {
    const metaPath = path.join(PDF_DIR, `${id}.json`);
    const meta: PdfMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    if (meta.filename) filename = meta.filename;
  } catch {
    /* 用默认文件名 */
  }
  return { buffer, filename };
}

/** 清理 24 小时前的旧 PDF */
function cleanupOldPdfs(): void {
  const maxAge = 24 * 60 * 60 * 1000;
  const now = Date.now();
  try {
    for (const file of fs.readdirSync(PDF_DIR)) {
      const fp = path.join(PDF_DIR, file);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(fp);
      }
    }
  } catch {
    /* ignore */
  }
}

// 每小时清理一次；global-guard 防 dev HMR 重复注册
const GC_KEY = "__pdfStoreCleanup";
if (
  typeof globalThis !== "undefined" &&
  !(globalThis as Record<string, unknown>)[GC_KEY]
) {
  cleanupOldPdfs();
  const timer = setInterval(cleanupOldPdfs, 60 * 60 * 1000);
  timer.unref?.();
  (globalThis as Record<string, unknown>)[GC_KEY] = true;
}
