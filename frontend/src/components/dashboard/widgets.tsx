"use client";
import { ArrowRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** One headline number: label, value, a hint line, an optional icon and link. */
export function Tile({ label, value, hint, icon: Icon, tone, href }: { label: string; value: string; hint?: string; icon?: LucideIcon; tone?: string; href?: string }) {
  const body = (
    <Card className={cn("h-full p-4", href && "transition-shadow hover:shadow-float")}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        {Icon && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon className="h-3.5 w-3.5" /></span>}
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums text-slate-900", tone)}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-slate-400">{hint}</div>}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/** A titled card, with an optional "open" link on the right. */
export function Section({ title, icon: Icon, href, linkLabel = "Open", children, className }: { title: string; icon?: LucideIcon; href?: string; linkLabel?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("space-y-3 p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">{Icon && <Icon className="h-4 w-4 text-brand" />}{title}</h2>
        {href && <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">{linkLabel} <ArrowRight className="h-3 w-3" /></Link>}
      </div>
      {children}
    </Card>
  );
}

/** A single measure across a few categories: one brand hue, value label at the end, the exact figure on hover. */
export function Bars({ rows, format, empty }: { rows: { key: string; label: string; value: number; hint?: string }[]; format: (n: number) => string; empty: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length || max === 0) return <p className="py-4 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="group grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm" title={`${r.label}: ${format(r.value)}${r.hint ? ` · ${r.hint}` : ""}`}>
          <span className="truncate text-slate-600">{r.label}</span>
          <span className="h-2.5 rounded-r-[4px] bg-slate-100">
            <span className="block h-full rounded-r-[4px] bg-brand/80 transition-colors group-hover:bg-brand" style={{ width: `${Math.max((r.value / max) * 100, r.value ? 2 : 0)}%` }} />
          </span>
          <span className="min-w-[3.5rem] text-right font-medium tabular-nums text-slate-800">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A quiet "nothing here" line inside a section. */
export const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">{children}</p>;
