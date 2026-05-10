"use client";

import * as React from "react";
import { Download, Loader2, Printer, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportData } from "@/lib/types";

interface ExportActionsProps {
  report: ReportData;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onExportingChange?: (exporting: boolean) => void;
  onNewAnalysis: () => void;
}

type PdfStatus = "preparing" | "ready" | "downloading" | "error";

export function ExportActions({
  report,
  onExportingChange,
  onNewAnalysis,
}: ExportActionsProps) {
  const [pdfStatus, setPdfStatus] = React.useState<PdfStatus>("preparing");
  const [pdfToken, setPdfToken] = React.useState<string | null>(null);
  const [pdfError, setPdfError] = React.useState<string | null>(null);
  const [prepEpoch, setPrepEpoch] = React.useState(0);
  const cancelledRef = React.useRef(false);

  // mount 时自动 POST /prepare 拿 token（服务端 fire-and-forget 启动 Puppeteer 渲染）
  React.useEffect(() => {
    cancelledRef.current = false;
    setPdfStatus("preparing");
    setPdfError(null);

    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/pdf/prepare`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportData: report }),
          },
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `准备失败 HTTP ${res.status}`);
        }
        const { token } = (await res.json()) as { token: string };
        if (!cancelledRef.current) {
          setPdfToken(token);
          setPdfStatus("ready");
        }
      } catch (e) {
        if (!cancelledRef.current) {
          console.error("[export-actions] pdf prepare failed:", e);
          setPdfError(e instanceof Error ? e.message : "准备下载链接失败");
          setPdfStatus("error");
        }
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepEpoch, report]);

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  const handleDownload = () => {
    if (pdfStatus === "error") {
      // 重试
      setPrepEpoch((n) => n + 1);
      return;
    }
    if (pdfStatus !== "ready" || !pdfToken) return;

    setPdfStatus("downloading");
    onExportingChange?.(true);

    const url = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/pdf?token=${encodeURIComponent(pdfToken)}`;

    // 同步打开新窗口（token 已有，window.open 在用户手势内）
    const popup = window.open(url, "_blank");
    if (!popup || popup.closed) {
      // popup 被拦截 fallback：Content-Disposition: attachment 触发下载
      window.location.href = url;
    }

    // 恢复按钮状态
    setTimeout(() => {
      if (!cancelledRef.current) {
        setPdfStatus("ready");
        onExportingChange?.(false);
      }
    }, 1500);
  };

  const downloadDisabled = pdfStatus === "preparing" || pdfStatus === "downloading";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--blue-100)] bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70 print:hidden pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1 text-xs text-[var(--muted-foreground)] truncate">
          生成时间：{new Date(report.meta.generatedAt).toLocaleString("zh-CN")}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 sm:h-9 min-h-[44px] sm:min-h-0"
            onClick={onNewAnalysis}
          >
            <RefreshCw className="size-4" />
            <span className="hidden sm:inline ml-1">重新分析</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 sm:h-9 min-h-[44px] sm:min-h-0"
            onClick={handlePrint}
          >
            <Printer className="size-4" />
            <span className="hidden sm:inline ml-1">打印</span>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleDownload}
            disabled={downloadDisabled}
            className="h-10 sm:h-9 min-h-[44px] sm:min-h-0 bg-[var(--navy-900)] hover:bg-[var(--navy-800)] text-white"
          >
            {pdfStatus === "preparing" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span className="ml-1 hidden sm:inline">准备中…</span>
              </>
            ) : pdfStatus === "downloading" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span className="ml-1 hidden sm:inline">下载中…</span>
              </>
            ) : pdfStatus === "error" ? (
              <>
                <RotateCw className="size-4" />
                <span className="ml-1">重试</span>
              </>
            ) : (
              <>
                <Download className="size-4" />
                <span className="ml-1">下载 PDF</span>
              </>
            )}
          </Button>
        </div>
      </div>
      {pdfStatus === "error" && pdfError && (
        <div className="max-w-5xl mx-auto px-4 pb-2 sm:px-6">
          <p className="text-[11px] text-red-600 text-right">{pdfError}</p>
        </div>
      )}
    </div>
  );
}
