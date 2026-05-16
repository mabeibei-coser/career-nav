"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, RotateCw } from "lucide-react";
import type { ReportData } from "@/lib/types";

interface Props {
  report: ReportData;
}

type Status = "generating" | "ready" | "downloading" | "error";

export function DownloadPDFButton({ report }: Props) {
  const [status, setStatus] = useState<Status>("generating");
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryEpoch, setRetryEpoch] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setStatus("generating");
    setErrorMsg(null);

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
          setStatus("ready");
        }
      } catch (e) {
        if (!cancelledRef.current) {
          console.error("[pdf-button] generate failed:", e);
          setErrorMsg(e instanceof Error ? e.message : "PDF 生成失败");
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [retryEpoch, report]);

  const onClick = () => {
    if (status !== "ready" || !pdfId) return;
    setStatus("downloading");

    const url = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/report/pdf?id=${encodeURIComponent(pdfId)}`;
    const popup = window.open(url, "_blank");
    if (!popup || popup.closed) {
      window.location.href = url;
    }

    setTimeout(() => {
      if (!cancelledRef.current) setStatus("ready");
    }, 1500);
  };

  const onRetry = () => {
    setRetryEpoch((n) => n + 1);
  };

  return (
    <div className="flex flex-col items-center gap-2 mt-6 print:hidden">
      <button
        type="button"
        onClick={status === "error" ? onRetry : onClick}
        disabled={status === "generating" || status === "downloading"}
        className="inline-flex items-center gap-2 rounded-lg bg-[var(--blue-500)] hover:bg-[var(--blue-600)] text-white font-semibold px-6 py-3 text-[15px] shadow-sm transition-all disabled:opacity-70 disabled:cursor-wait min-w-[200px] justify-center"
      >
        {status === "generating" ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            <span>正在生成 PDF…</span>
          </>
        ) : status === "downloading" ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            <span>正在下载…</span>
          </>
        ) : status === "error" ? (
          <>
            <RotateCw className="size-4" />
            <span>生成失败，点击重试</span>
          </>
        ) : (
          <>
            <Download className="size-4" />
            <span>下载 PDF 报告</span>
          </>
        )}
      </button>
      {status === "error" && errorMsg && (
        <p className="text-[12px] text-red-600 max-w-md text-center">{errorMsg}</p>
      )}
    </div>
  );
}
