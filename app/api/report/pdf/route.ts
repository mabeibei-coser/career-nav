import { NextRequest, NextResponse } from "next/server";
import type { ReportData } from "@/lib/types";
import { savePdf, getPdf } from "@/lib/pdf-store";

export const runtime = "nodejs";
export const maxDuration = 180;

const INTERNAL_BASE =
  process.env.PDF_INTERNAL_BASE_URL ||
  `http://127.0.0.1:${process.env.PORT || 3000}${process.env.NEXT_PUBLIC_BASE_PATH || ""}`;

/**
 * Puppeteer 渲染 → PDF Buffer
 */
async function renderPdfBuffer(reportData: ReportData): Promise<Buffer> {
  const puppeteer = await import("puppeteer");
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch({
      headless: "shell",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
        "--font-render-hinting=none",
      ],
    });

    const page = await browser.newPage();
    page.on("pageerror", (e: unknown) => {
      console.error("[pdf:pageerror]", e instanceof Error ? e.message : String(e));
    });

    await page.setViewport({ width: 1024, height: 1400, deviceScaleFactor: 2 });

    const reportDataStr = JSON.stringify(reportData);
    await page.evaluateOnNewDocument((dataStr: string) => {
      try {
        const data = JSON.parse(dataStr);
        window.sessionStorage.setItem("reportData", dataStr);
        if (data?.meta?.formData) {
          window.sessionStorage.setItem("formData", JSON.stringify(data.meta.formData));
        }
        if (data?.meta?.scoring) {
          window.sessionStorage.setItem("scoring", JSON.stringify(data.meta.scoring));
        }
        window.sessionStorage.setItem("quizAnswers", JSON.stringify(data?.meta?.quizAnswers || []));
      } catch { /* ignore */ }
    }, reportDataStr);

    const url = `${INTERNAL_BASE}/report?pdf=1`;
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("[data-pdf-section]", { timeout: 60000 });
    await page.evaluate(() => document.fonts?.ready);
    await new Promise((r) => setTimeout(r, 800));

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "14mm", right: "10mm", bottom: "18mm", left: "10mm" },
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate: `
        <div style="width:100%; padding:0 10mm; font-size:9px; color:#6b7280; display:flex; justify-content:space-between; font-family:'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif;">
          <span>谨世 ATA · 职业导航报告</span>
          <span>第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</span>
        </div>
      `,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * POST：接收 reportData → Puppeteer 渲染 → 存盘 → 返回 { pdfId }
 */
export async function POST(req: NextRequest) {
  // E2E mock
  if (process.env.E2E_MOCK_MODE === "true") {
    return NextResponse.json({ pdfId: "e2e-mock" });
  }

  let body: { reportData?: ReportData };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const reportData = body?.reportData;
  if (!reportData?.meta?.formData?.identity) {
    return NextResponse.json({ error: "缺少 reportData" }, { status: 400 });
  }

  try {
    const buffer = await renderPdfBuffer(reportData);
    const pdfId = savePdf(buffer, reportData);
    return NextResponse.json({ pdfId });
  } catch (e) {
    console.error("[pdf] generation failed:", e);
    const message = e instanceof Error ? e.message : "PDF 生成失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET ?id=xxx：从磁盘读取 PDF 文件 → 流式返回
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });
  }

  // E2E mock
  if (process.env.E2E_MOCK_MODE === "true" && id === "e2e-mock") {
    const minimalPdf = Buffer.from(
      "%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/MediaBox[0 0 595 842]>>endobj\n" +
      "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
      "0000000058 00000 n \n0000000115 00000 n \n" +
      "trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n",
      "ascii"
    );
    return new NextResponse(new Uint8Array(minimalPdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="e2e-mock-report.pdf"',
      },
    });
  }

  const result = getPdf(id);
  if (!result) {
    return NextResponse.json(
      { error: "PDF 文件不存在或已过期" },
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
