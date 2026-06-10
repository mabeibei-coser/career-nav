"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";

interface LegalData {
  type: string;
  title: string;
  content: string;
  updatedAt: number;
}

const FALLBACK_TITLE: Record<string, string> = {
  terms: "服务使用协议",
  privacy: "隐私政策",
};

export default function LegalPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = use(params);
  const router = useRouter();
  const [data, setData] = useState<LegalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/legal/${type}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `加载失败 (${r.status})`);
        }
        return r.json() as Promise<LegalData>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || "加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  const fallbackTitle = FALLBACK_TITLE[type] ?? "协议内容";

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="fixed inset-0 bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)]" />
      <div className="fixed inset-0 hero-grid opacity-40" />

      <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 text-[13px] text-[var(--muted-foreground)] hover:text-[var(--navy-800)] transition-colors"
            aria-label="返回"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 3L5 8l5 5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            返回
          </button>
        </div>

        <div className="glass-card rounded-xl p-5 sm:p-7">
          <h1 className="text-[1.25rem] sm:text-[1.4rem] font-bold text-[var(--navy-900)] tracking-tight mb-4">
            {data?.title || fallbackTitle}
          </h1>
          {error && (
            <p className="text-sm text-red-600">加载失败：{error}</p>
          )}
          {!error && !data && (
            <p className="text-sm text-[var(--muted-foreground)]">加载中…</p>
          )}
          {data && !data.content && (
            <p className="text-sm text-[var(--muted-foreground)]">
              协议内容暂未配置,请联系平台管理员。
            </p>
          )}
          {data && data.content && <MarkdownView text={data.content} />}
        </div>
      </div>
    </div>
  );
}

// 极简 Markdown 渲染:覆盖 # ## ### 标题 / 段落 / - * 列表 / **加粗** / [文本](url)
// 与 ATA100 / ASG100 一致,不引第三方依赖。
function MarkdownView({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className="legal-markdown text-[0.92rem] leading-[1.75] text-[var(--navy-800)]">
      {blocks.map((b, i) => renderBlock(b, i))}
      <style jsx>{`
        .legal-markdown :global(h1),
        .legal-markdown :global(h2),
        .legal-markdown :global(h3) {
          color: var(--navy-900);
          font-weight: 700;
          letter-spacing: -0.012em;
        }
        .legal-markdown :global(h1) {
          font-size: 1.12rem;
          margin: 1.5rem 0 0.75rem;
        }
        .legal-markdown :global(h2) {
          font-size: 1.02rem;
          margin: 1.25rem 0 0.6rem;
        }
        .legal-markdown :global(h3) {
          font-size: 0.96rem;
          margin: 1rem 0 0.5rem;
        }
        .legal-markdown :global(p) {
          margin: 0 0 0.8rem;
        }
        .legal-markdown :global(ul) {
          padding-left: 1.4rem;
          margin: 0 0 0.8rem;
        }
        .legal-markdown :global(li) {
          margin-bottom: 0.35rem;
        }
        .legal-markdown :global(strong) {
          font-weight: 700;
          color: var(--navy-900);
        }
        .legal-markdown :global(a) {
          color: var(--blue-600);
          text-decoration: underline;
        }
        .legal-markdown > :global(*:first-child) {
          margin-top: 0;
        }
      `}</style>
    </div>
  );
}

type Block =
  | { type: "h"; level: number; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

function parseMarkdownBlocks(text: string): Block[] {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: "ul"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "p", text: para.join(" ") });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ type: "h", level: h[1].length, text: h[2] });
      continue;
    }
    const li = line.match(/^[-*]\s+(.+)$/);
    if (li) {
      flushPara();
      if (!list) list = { type: "ul", items: [] };
      list.items.push(li[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

function renderBlock(b: Block, i: number) {
  if (b.type === "h") {
    if (b.level === 1) return <h1 key={i}>{renderInline(b.text)}</h1>;
    if (b.level === 2) return <h2 key={i}>{renderInline(b.text)}</h2>;
    return <h3 key={i}>{renderInline(b.text)}</h3>;
  }
  if (b.type === "ul") {
    return (
      <ul key={i}>
        {b.items.map((it, j) => (
          <li key={j}>{renderInline(it)}</li>
        ))}
      </ul>
    );
  }
  return <p key={i}>{renderInline(b.text)}</p>;
}

function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = String(text || "");
  let idx = 0;
  const re = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/;
  let m;
  while ((m = rest.match(re))) {
    if (m.index! > 0) out.push(<span key={idx++}>{rest.slice(0, m.index)}</span>);
    if (m[1]) {
      out.push(<strong key={idx++}>{m[2]}</strong>);
    } else {
      out.push(
        <a key={idx++} href={m[5]} target="_blank" rel="noopener noreferrer">
          {m[4]}
        </a>
      );
    }
    rest = rest.slice(m.index! + m[0].length);
  }
  if (rest) out.push(<span key={idx++}>{rest}</span>);
  return out;
}
