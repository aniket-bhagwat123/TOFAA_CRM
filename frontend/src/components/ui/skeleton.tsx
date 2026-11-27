import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A grey placeholder that stands where content will appear. */
export const Skeleton = ({ className }: { className?: string }) => (
  <span aria-hidden="true" className={cn("block animate-pulse rounded-md bg-slate-200/70 motion-reduce:animate-none", className)} />
);

const Loading = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div role="status" aria-label="Loading" className={cn("w-full min-w-0", className)}>{children}</div>
);

const WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-2/5"];
const widthAt = (row: number, column: number) => WIDTHS[(row + column * 2) % WIDTHS.length];

/** A table or list while it loads: a header line and rows shaped like the real ones. `bare` drops the card around it. */
export function TableSkeleton({ rows = 8, columns = 5, avatar = true, bare, className }: { rows?: number; columns?: number; avatar?: boolean; bare?: boolean; className?: string }) {
  const grid = { gridTemplateColumns: `minmax(0,1.6fr) repeat(${columns - 1}, minmax(0,1fr))` };
  return (
    <Loading className={cn("self-start overflow-hidden", !bare && "rounded-2xl border border-slate-200/80 bg-white shadow-card", className)}>
      <div className="grid gap-4 border-b border-slate-200 bg-slate-50/80 px-4 py-3.5" style={grid}>
        {Array.from({ length: columns }, (_, c) => <Skeleton key={c} className="h-3 w-1/2" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid items-center gap-4 border-b border-slate-100 px-4 py-3.5 last:border-0" style={grid}>
          {Array.from({ length: columns }, (_, c) => c === 0 && avatar ? (
            <span key={c} className="flex min-w-0 items-center gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <span className="min-w-0 flex-1 space-y-2"><Skeleton className={cn("h-3", widthAt(r, c))} /><Skeleton className="h-2.5 w-1/3" /></span>
            </span>
          ) : <Skeleton key={c} className={cn("h-3", widthAt(r, c))} />)}
        </div>
      ))}
    </Loading>
  );
}

/** A board (columns of cards) while it loads. */
export function BoardSkeleton({ columns = 4, cards = 3, className }: { columns?: number; cards?: number; className?: string }) {
  return (
    <Loading className={cn("flex flex-1 gap-3 overflow-hidden", className)}>
      {Array.from({ length: columns }, (_, c) => (
        <div key={c} className="w-72 min-w-0 flex-1 space-y-3 rounded-2xl bg-slate-100/70 p-3">
          <Skeleton className="h-4 w-1/2" />
          {Array.from({ length: Math.max(1, cards - (c % 2)) }, (_, i) => (
            <div key={i} className="space-y-2.5 rounded-xl bg-white p-3.5 shadow-card">
              <Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ))}
    </Loading>
  );
}
