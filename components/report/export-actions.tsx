"use client";

import * as React from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportData } from "@/lib/types";

interface ExportActionsProps {
  report: ReportData;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onExportingChange?: (exporting: boolean) => void;
  onNewAnalysis: () => void;
}

export function ExportActions({
  report,
  onExportingChange,
  onNewAnalysis,
}: ExportActionsProps) {
  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  // 下载 PDF：触发浏览器原生打印对话框（支持"另存为PDF"）
  // 替代原来的 html2canvas 方案，避免安卓 Canvas API 兼容性问题
  const handleDownload = () => {
    onExportingChange?.(true);
    // 短暂延迟让调用方可先关闭动画
    setTimeout(() => {
      if (typeof window !== "undefined") window.print();
      onExportingChange?.(false);
    }, 50);
  };

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
            className="h-10 sm:h-9 min-h-[44px] sm:min-h-0 bg-[var(--navy-900)] hover:bg-[var(--navy-800)] text-white"
          >
            <Download className="size-4" />
            <span className="ml-1">下载 PDF</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
