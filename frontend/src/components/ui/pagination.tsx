"use client";
/**
 * The footer under a paged table: "Showing 1–25 of 478 people", a rows-per-page choice, and page buttons
 * (first, last, and the pages around the current one, with "…" between).
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const PAGE_SIZES = [10, 25, 50, 100];

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  noun?: [singular: string, plural: string];
  loading?: boolean;
};

function pageList(page: number, pages: number): (number | "gap")[] {
  const keep = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  const out: (number | "gap")[] = [];
  keep.forEach((n, i) => {
    if (i && n - keep[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

export function Pagination({ page, pageSize, total, onPage, onPageSize, noun = ["row", "rows"], loading }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const button = "pressable flex h-9 min-w-9 items-center justify-center rounded-lg px-2.5 text-sm font-medium tabular-nums";

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm tabular-nums text-slate-600" aria-live="polite">
          {loading ? "Loading…" : total ? <>Showing <b className="font-semibold text-slate-900">{from}–{to}</b> of <b className="font-semibold text-slate-900">{total}</b> {total === 1 ? noun[0] : noun[1]}</> : `No ${noun[1]}`}
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          Rows per page
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-9 cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-700 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-1">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}
            className={cn(button, "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40")}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageList(page, pages).map((n, i) => n === "gap"
            ? <span key={`gap-${i}`} className="px-1 text-slate-400" aria-hidden="true">…</span>
            : (
              <button key={n} type="button" aria-label={`Page ${n}`} aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)}
                className={cn(button, n === page ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100")}>
                {n}
              </button>
            ))}
          <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}
            className={cn(button, "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40")}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      )}
    </div>
  );
}
