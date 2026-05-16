"use client";

import * as React from "react";
import { FileText, Loader2, Upload, X, CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Status = "idle" | "uploading" | "success" | "error";

export interface FileUploadValue {
  fileName: string;
  text: string;
  charCount?: number;
  truncated?: boolean;
  resumeRef?: string;
  resumeFilename?: string;
  /** 服务端从简历正文启发式抽取的姓名；提取不到为 null，前端不展示 */
  extractedName?: string | null;
}

export interface FileUploadProps {
  value?: FileUploadValue | null;
  onChange?: (value: FileUploadValue | null) => void;
  accept?: string;
  maxSizeMB?: number;
  className?: string;
  disabled?: boolean;
  endpoint?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileUpload({
  value = null,
  onChange,
  accept = ".pdf,.doc,.docx",
  maxSizeMB = 5,
  className,
  disabled = false,
  endpoint = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/resume/parse`,
}: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [status, setStatus] = React.useState<Status>(
    value ? "success" : "idle"
  );
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [lastFileMeta, setLastFileMeta] = React.useState<{
    name: string;
    size: number;
  } | null>(value ? { name: value.fileName, size: 0 } : null);

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const validate = (file: File): string | null => {
    const maxBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
      return `文件大小超过 ${maxSizeMB}MB`;
    }
    const lower = file.name.toLowerCase();
    const ok =
      lower.endsWith(".pdf") ||
      lower.endsWith(".docx") ||
      lower.endsWith(".doc");
    if (!ok) return "仅支持 PDF / Word (.docx) 格式";
    return null;
  };

  const handleFile = async (file: File) => {
    setErrorMsg(null);
    const err = validate(file);
    if (err) {
      setStatus("error");
      setErrorMsg(err);
      return;
    }
    setStatus("uploading");
    setLastFileMeta({ name: file.name, size: file.size });

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(endpoint, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "简历解析失败");
      }
      const next: FileUploadValue = {
        fileName: data.fileName ?? file.name,
        text: data.text,
        charCount: data.charCount,
        truncated: data.truncated,
        resumeRef: data.resumeRef,
        resumeFilename: data.resumeFilename,
        extractedName: data.extractedName ?? null,
      };
      setStatus("success");
      onChange?.(next);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "上传失败，请重试");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const clear = () => {
    setStatus("idle");
    setLastFileMeta(null);
    setErrorMsg(null);
    onChange?.(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const preview =
    value?.text && value.text.length > 200
      ? value.text.slice(0, 200) + "…"
      : value?.text;

  return (
    <div className={cn("w-full", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleInputChange}
        disabled={disabled}
      />

      {status !== "success" && (
        <button
          type="button"
          onClick={openPicker}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          disabled={disabled || status === "uploading"}
          className={cn(
            "group flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 transition-colors",
            "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50",
            status === "error" && "border-destructive/60 bg-destructive/5",
            disabled && "cursor-not-allowed opacity-60"
          )}
        >
          {status === "uploading" ? (
            <>
              <Loader2 className="size-6 animate-spin text-primary" />
              <div className="text-sm text-muted-foreground">
                解析中，请稍候…
                {lastFileMeta && (
                  <span className="ml-1 text-xs">
                    ({lastFileMeta.name} · {formatSize(lastFileMeta.size)})
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <Upload className="size-6 text-muted-foreground group-hover:text-primary" />
              <div className="text-sm font-medium">
                点击或拖拽上传简历
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                  选填
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                支持 PDF 与 Word（.docx），单个文件 ≤ {maxSizeMB}MB
              </div>
              {errorMsg && (
                <div className="mt-1 text-xs font-medium text-destructive">
                  {errorMsg}
                </div>
              )}
            </>
          )}
        </button>
      )}

      {status === "success" && value && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <FileText className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">{value.fileName}</span>
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                已解析
                {typeof value.charCount === "number" && (
                  <span className="ml-1">· 约 {value.charCount} 字</span>
                )}
                {value.truncated && (
                  <span className="ml-1 text-amber-600">
                    （超长内容已自动截取）
                  </span>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              onClick={clear}
              aria-label="移除简历"
            >
              <X className="size-4" />
            </Button>
          </div>
          {preview && (
            <div className="max-h-24 overflow-hidden rounded-md bg-background/60 p-2 text-xs leading-relaxed text-muted-foreground">
              {preview}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
