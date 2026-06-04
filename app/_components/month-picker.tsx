"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 5;
const PAD = Math.floor(VISIBLE_ITEMS / 2);

const MIN_YEAR = 1950;
const MAX_YEAR = new Date().getFullYear();
const FALLBACK_YEAR = 1995;
const FALLBACK_MONTH = 1;

const YEARS: number[] = (() => {
  const arr: number[] = [];
  for (let y = MIN_YEAR; y <= MAX_YEAR; y++) arr.push(y);
  return arr;
})();
const MONTHS: number[] = Array.from({ length: 12 }, (_, i) => i + 1);

function parseValue(value: string): { year: number; month: number } | null {
  const m = value.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function formatValue(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

type WheelProps = {
  items: number[];
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
};

function Wheel({ items, value, onChange, suffix = "" }: WheelProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<number | null>(null);

  // mount 时滚动到 value 位置（无动画，避免开屏即"飞"）
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = items.indexOf(value);
    if (idx >= 0) el.scrollTop = idx * ITEM_HEIGHT;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部 value 变化时同步（重新打开 modal 等场景）
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = items.indexOf(value);
    if (idx < 0) return;
    const target = idx * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - target) > 1) {
      el.scrollTo({ top: target, behavior: "smooth" });
    }
  }, [value, items]);

  const handleScroll = () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const rawIdx = Math.round(el.scrollTop / ITEM_HEIGHT);
      const idx = Math.max(0, Math.min(items.length - 1, rawIdx));
      const next = items[idx];
      if (next !== value) onChange(next);
      const target = idx * ITEM_HEIGHT;
      if (Math.abs(el.scrollTop - target) > 1) {
        el.scrollTo({ top: target, behavior: "smooth" });
      }
    }, 140);
  };

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      className="relative flex-1 overflow-y-scroll snap-y snap-mandatory [&::-webkit-scrollbar]:hidden"
      style={{
        height: VISIBLE_ITEMS * ITEM_HEIGHT,
        scrollbarWidth: "none",
        WebkitMaskImage:
          "linear-gradient(180deg, transparent 0, #000 38%, #000 62%, transparent 100%)",
        maskImage:
          "linear-gradient(180deg, transparent 0, #000 38%, #000 62%, transparent 100%)",
      }}
    >
      <div style={{ height: PAD * ITEM_HEIGHT }} aria-hidden />
      {items.map((it) => (
        <div
          key={it}
          className={cn(
            "flex items-center justify-center snap-center select-none transition-colors",
            it === value
              ? "text-[var(--navy-800)] text-lg font-medium"
              : "text-gray-400 text-base"
          )}
          style={{ height: ITEM_HEIGHT, scrollSnapAlign: "center" }}
        >
          {it}
          {suffix}
        </div>
      ))}
      <div style={{ height: PAD * ITEM_HEIGHT }} aria-hidden />
    </div>
  );
}

export type MonthPickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  className?: string;
};

export function MonthPicker({
  id,
  value,
  onChange,
  placeholder = "选择年月",
  invalid = false,
  className,
}: MonthPickerProps) {
  const [open, setOpen] = React.useState(false);
  const parsed = parseValue(value);

  const [tempYear, setTempYear] = React.useState<number>(
    parsed?.year ?? FALLBACK_YEAR,
  );
  const [tempMonth, setTempMonth] = React.useState<number>(
    parsed?.month ?? FALLBACK_MONTH,
  );

  // 每次打开 reset 临时值到当前已选（取消后下次打开不残留）
  React.useEffect(() => {
    if (!open) return;
    const p = parseValue(value);
    setTempYear(p?.year ?? FALLBACK_YEAR);
    setTempMonth(p?.month ?? FALLBACK_MONTH);
  }, [open, value]);

  // 打开面板时锁定 body 滚动（避免页面背景跟着滚）
  React.useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  const display = parsed ? `${parsed.year}年${parsed.month}月` : "";

  const handleConfirm = () => {
    onChange(formatValue(tempYear, tempMonth));
    setOpen(false);
  };

  const handleCancel = () => setOpen(false);

  return (
    <>
      <button
        id={id}
        type="button"
        onClick={() => setOpen(true)}
        aria-invalid={invalid}
        className={cn(
          "h-12 w-full rounded-lg border border-[var(--blue-200)] bg-white/60 px-3 text-base md:text-sm text-left transition-colors",
          "focus:border-[var(--blue-400)] focus-visible:ring-2 focus-visible:ring-[var(--blue-500)]/20 focus:outline-none",
          "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
          display ? "text-[var(--navy-800)]" : "text-muted-foreground",
          className,
        )}
      >
        {display || placeholder}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          role="dialog"
          aria-modal="true"
          aria-label="设置月份"
        >
          <button
            type="button"
            aria-label="关闭"
            onClick={handleCancel}
            className="absolute inset-0 bg-black/40"
          />
          <div
            className="relative w-full bg-white rounded-t-2xl shadow-xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="text-center py-3 text-sm text-gray-500 border-b border-gray-100">
              设置月份
            </div>
            <div className="relative px-6 py-2">
              <div
                className="pointer-events-none absolute left-6 right-6 top-1/2 -translate-y-1/2 border-y border-gray-200"
                style={{ height: ITEM_HEIGHT }}
                aria-hidden
              />
              <div className="flex items-stretch gap-6">
                <Wheel
                  items={YEARS}
                  value={tempYear}
                  onChange={setTempYear}
                  suffix=""
                />
                <Wheel
                  items={MONTHS}
                  value={tempMonth}
                  onChange={setTempMonth}
                  suffix=""
                />
              </div>
            </div>
            <div className="flex border-t border-gray-100">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 py-3.5 text-base text-gray-600 active:bg-gray-50"
              >
                取消
              </button>
              <div className="w-px bg-gray-100" aria-hidden />
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 py-3.5 text-base font-medium text-[var(--blue-500)] active:bg-gray-50"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
