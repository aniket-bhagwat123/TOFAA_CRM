"use client";
import { Lightbulb, Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import { inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { TargetCardData } from "@/types/crm";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div>
    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
    <div className={cn("text-lg font-semibold tracking-tight text-slate-900", tone)}>{value}</div>
  </div>
);

/** Where you stand this month: target, won, what is left, what the open deals are worth, and what to do about it. */
export function TargetCard({ card }: { card: TargetCardData }) {
  const pct = Math.round(card.progress * 100);
  const none = card.target === 0;
  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Target className="h-4 w-4 text-brand" /> {monthLabel(card.month)}</h2>
        {!none && (
          <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", card.healthy ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
            {card.gap === 0 ? "Target reached" : card.healthy ? "Pipeline healthy" : "Pipeline is thin"}
          </span>
        )}
      </div>

      {!none && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="font-semibold text-slate-900">{inrShort(card.won)} <span className="font-normal text-slate-400">of {inrShort(card.target)}</span></span>
            <span className="font-semibold text-brand">{pct}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to monthly target">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {!none && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="Gap" value={inrShort(card.gap)} />
          <Stat label="Weighted pipeline" value={inrShort(card.weighted)} />
          <Stat label="Still short" value={inrShort(card.shortfall)} tone={card.shortfall > 0 ? "text-amber-600" : "text-emerald-600"} />
          <Stat label="Open pipeline" value={inrShort(card.unweighted)} />
        </div>
      )}

      <p className="flex items-start gap-2 rounded-xl bg-brand-soft/70 px-3.5 py-3 text-sm text-slate-700"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand" />{card.suggestion}</p>
    </Card>
  );
}
