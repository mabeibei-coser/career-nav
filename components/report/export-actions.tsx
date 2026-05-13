"use client";

import * as React from "react";
import { Download, Loader2, RotateCw, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportData } from "@/lib/types";

interface ExportActionsProps {
  report: ReportData;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onExportingChange?: (exporting: boolean) => void;
  onNewAnalysis: () => void;
}

type PdfStatus = "generating" | "ready" | "downloading" | "error";

export function ExportActions({
  report,
}: ExportActionsProps) {
  const [pdfStatus, setPdfStatus] = React.useState<PdfStatus>("generating");
  const [pdfId, setPdfId] = React.useState<string | null>(null);
  const [pdfError, setPdfError] = React.useState<string | null>(null);
  const [retryEpoch, setRetryEpoch] = React.useState(0);
  const [showContact, setShowContact] = React.useState(false);
  const cancelledRef = React.useRef(false);

  // mount 时 POST 生成 PDF → 服务端渲染并存盘 → 返回 pdfId
  React.useEffect(() => {
    cancelledRef.current = false;
    setPdfStatus("generating");
    setPdfError(null);

    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/pdf`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportData: report }),
          },
        );
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `生成失败 HTTP ${res.status}`);
        }
        const { pdfId: id } = (await res.json()) as { pdfId: string };
        if (!cancelledRef.current) {
          setPdfId(id);
          setPdfStatus("ready");
        }
      } catch (e) {
        if (!cancelledRef.current) {
          console.error("[export-actions] pdf generate failed:", e);
          setPdfError(e instanceof Error ? e.message : "PDF 生成失败");
          setPdfStatus("error");
        }
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryEpoch, report]);

  const handleDownload = () => {
    if (pdfStatus === "error") {
      setRetryEpoch((n) => n + 1);
      return;
    }
    if (pdfStatus !== "ready" || !pdfId) return;

    setPdfStatus("downloading");

    // 直接从磁盘下载，不再依赖内存 token
    const url = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/pdf?id=${encodeURIComponent(pdfId)}`;
    const popup = window.open(url, "_blank");
    if (!popup || popup.closed) {
      window.location.href = url;
    }

    setTimeout(() => {
      if (!cancelledRef.current) {
        setPdfStatus("ready");
      }
    }, 1500);
  };

  const downloadDisabled = pdfStatus === "generating" || pdfStatus === "downloading";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--blue-100)] bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70 print:hidden pb-[env(safe-area-inset-bottom)]">
      {/* 预约服务展开信息 */}
      {showContact && (
        <div className="max-w-5xl mx-auto px-4 pt-3 pb-1 sm:px-6">
          <div className="rounded-xl border border-[var(--blue-200)] bg-[var(--blue-50)] px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <Phone className="size-5 text-[var(--blue-600)] shrink-0" />
              <span className="text-[15px] font-semibold text-[var(--navy-900)]">
                线下咨询服务
              </span>
            </div>
            <div className="space-y-1.5 pl-7">
              <p className="text-[15px] leading-[1.7] text-[var(--navy-800)]">
                咨询电话：
                <a href="tel:02163011095" className="font-semibold text-[var(--blue-600)] underline underline-offset-2">
                  021-63011095
                </a>
                、
                <a href="tel:02163137613" className="font-semibold text-[var(--blue-600)] underline underline-offset-2">
                  021-63137613
                </a>
              </p>
              <p className="text-[14px] leading-[1.7] text-[var(--navy-700)]">
                地址：黄浦区中山南一路555号
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 py-3 sm:px-6">
        {/* 预约服务 */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 h-11 min-h-[44px] text-[15px]"
          onClick={() => setShowContact((v) => !v)}
        >
          <Phone className="size-4" />
          <span className="ml-1.5">预约线下服务</span>
        </Button>

        {/* 下载 PDF */}
        <Button
          type="button"
          size="sm"
          onClick={handleDownload}
          disabled={downloadDisabled}
          className="flex-1 h-11 min-h-[44px] text-[15px] bg-[var(--navy-900)] hover:bg-[var(--navy-800)] text-white"
        >
          {pdfStatus === "generating" ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span className="ml-1.5">PDF 生成中…</span>
            </>
          ) : pdfStatus === "downloading" ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span className="ml-1.5">下载中…</span>
            </>
          ) : pdfStatus === "error" ? (
            <>
              <RotateCw className="size-4" />
              <span className="ml-1.5">重试下载</span>
            </>
          ) : (
            <>
              <Download className="size-4" />
              <span className="ml-1.5">下载 PDF 报告</span>
            </>
          )}
        </Button>
      </div>
      {pdfStatus === "error" && pdfError && (
        <div className="max-w-5xl mx-auto px-4 pb-2 sm:px-6">
          <p className="text-[11px] text-red-600 text-right">{pdfError}</p>
        </div>
      )}
    </div>
  );
}
