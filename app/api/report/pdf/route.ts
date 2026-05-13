import { NextRequest, NextResponse } from "next/server";
import type { ReportData } from "@/lib/types";
import { peekReportData, takeReportData } from "@/lib/pdf-token-store";
import { getJob } from "@/lib/pdf-job-store";

export const runtime = "nodejs";
export const maxDuration = 180; // dev 模式 Turbopack 冷编译 /report + Puppeteer 启动 + 渲染合计可能 ~90-120s

// 通过 127.0.0.1 让 headless Chromium 回访自己的页面
// 必须拼 basePath，否则 Next.js 返回 404，data-pdf-section 永远不出现
const INTERNAL_BASE =
  process.env.PDF_INTERNAL_BASE_URL ||
  `http://127.0.0.1:${process.env.PORT || 3000}${process.env.NEXT_PUBLIC_BASE_PATH || ""}`;

function todayYYYYMMDD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * 核心渲染：启 Puppeteer → 打开 /report?pdf=1 → 导出 Buffer。
 *
 * 纯 Buffer 输出（不包 NextResponse），好给 pdf-job-store 缓存 Promise<Buffer>，
 * 也让 POST / GET 两个入口都复用同一份逻辑。
 */
export async function renderPdfBuffer(reportData: ReportData): Promise<Buffer> {
  // 动态 import puppeteer，避免构建期被静态分析报错
  const puppeteer = await import("puppeteer");

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch({
      // shell 模式（chrome-headless-shell）是预装好的轻量 Chrome。
      // 完整 Chrome 需 `npx puppeteer browsers install chrome` 联网下载 ~150MB，
      // 国内网络下载困难，所以保持 shell 模式兼容
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

    // 仅捕获页面里的未捕获异常（正常 console 不转发，避免污染服务端日志）
    page.on("pageerror", (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[pdf:pageerror]", msg);
    });

    // 桌面布局 + 2x DPI
    await page.setViewport({ width: 1024, height: 1400, deviceScaleFactor: 2 });

    // 关键：用 evaluateOnNewDocument 让"写 sessionStorage"脚本在每个页面加载
    // 最早期运行，**早于任何页面 JS**。
    // report page 要求 formData / quizAnswers / scoring 三项都存在才渲染，
    // 否则 redirect 到 /。必须从 reportData.meta 里提取并注入。
    const reportDataStr = JSON.stringify(reportData);
    await page.evaluateOnNewDocument((dataStr: string) => {
      try {
        const data = JSON.parse(dataStr);
        window.sessionStorage.setItem("reportData", dataStr);
        // report page 先检查这三项，缺一则 redirect → 必须注入
        if (data?.meta?.formData) {
          window.sessionStorage.setItem("formData", JSON.stringify(data.meta.formData));
        }
        if (data?.meta?.scoring) {
          window.sessionStorage.setItem("scoring", JSON.stringify(data.meta.scoring));
        }
        // quizAnswers 报告页只检查存在性，用空数组占位即可
        window.sessionStorage.setItem("quizAnswers", JSON.stringify(data?.meta?.quizAnswers || []));
      } catch {
        /* ignore storage errors */
      }
    }, reportDataStr);

    // 直接跳 /report 页面，sessionStorage 在任何页面 JS 执行前已注入
    const url = `${INTERNAL_BASE}/report?pdf=1`;
    // waitUntil: "load"（比 domcontentloaded 晚，等所有资源加载完；
    // 不用 networkidle0 因为 dev 模式 HMR websocket 永远不 idle）
    await page.goto(url, { waitUntil: "load", timeout: 60000 });

    // React hydrate 完成后 section 才出现。shell 模式下 hydration 可能较慢
    await page.waitForSelector("[data-pdf-section]", { timeout: 60000 });
    await page.evaluate(() => document.fonts?.ready);
    // 再多等 800ms 给 framer-motion / recharts 初始渲染收敛
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
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}

function buildPdfResponse(buffer: Buffer, filename: string): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

function filenameFor(reportData: ReportData | null): string {
  const position = reportData?.meta?.formData?.targetPosition ?? "报告";
  return `职业导航报告_${position}_${todayYYYYMMDD()}.pdf`;
}

async function renderAndRespond(reportData: ReportData): Promise<NextResponse> {
  try {
    const buffer = await renderPdfBuffer(reportData);
    return buildPdfResponse(buffer, filenameFor(reportData));
  } catch (e) {
    console.error("[pdf] generation failed:", e);
    const message = e instanceof Error ? e.message : "PDF 生成失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST：旧接口（直接接 reportData，现场渲染返回）。保留向后兼容。
 */
export async function POST(req: NextRequest) {
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

  return renderAndRespond(reportData);
}

/**
 * GET：带 token 的主下载路径。优先复用 pdf-job-store 的缓存 Promise；
 * 若 job 不存在/失败，用 peekReportData 做一次兜底现场渲染。
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "缺少 token" }, { status: 400 });
  }

  // E2E_MOCK_MODE: 直接返回最小合法 PDF，不启动 Puppeteer
  if (process.env.E2E_MOCK_MODE === "true" && token === "e2e-mock-pdf-token") {
    const minimalPdf = Buffer.from(
      "%PDF-1.0\n" +
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/MediaBox[0 0 595 842]>>endobj\n" +
      "xref\n0 4\n" +
      "0000000000 65535 f \n" +
      "0000000009 00000 n \n" +
      "0000000058 00000 n \n" +
      "0000000115 00000 n \n" +
      "trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n",
      "ascii"
    );
    return new NextResponse(new Uint8Array(minimalPdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="e2e-mock-report.pdf"',
        "Cache-Control": "no-store",
      },
    });
  }

  // 优先命中 job：已就绪秒回；未就绪 HTTP 长连接天然 hold 住 await
  const job = getJob(token);
  if (job) {
    try {
      const buffer = await job.promise;
      // reportData 仅用来拼文件名；job 可能比 token TTL 活得久，拿不到就降级通用文件名
      const reportData = peekReportData(token);
      return buildPdfResponse(buffer, filenameFor(reportData));
    } catch (jobErr) {
      // job 渲染失败 → 落到下面 fallback 现场渲染兜底一次
      console.warn(
        "[pdf] job promise rejected, falling back to on-demand render:",
        jobErr instanceof Error ? jobErr.message : String(jobErr)
      );
    }
  }

  // Fallback：job 不存在/失败，用非消费性 peek 拿 reportData 现场渲染。
  // 不用 take 消费是因为下载可能要重试；TTL 到期自然清理。
  let reportData = peekReportData(token);
  if (!reportData) {
    // peek 为空再试 take（处理极端遗留场景；takeReportData 保留向后兼容）
    reportData = takeReportData(token);
  }
  if (!reportData) {
    return NextResponse.json(
      { error: "链接已过期或已被使用，请回报告页重新下载" },
      { status: 404 }
    );
  }
  return renderAndRespond(reportData);
}
