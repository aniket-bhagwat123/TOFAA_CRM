"use client";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { formatDate } from "@/lib/format";
import { dealHref } from "@/lib/links";
import type { Lead } from "@/types/crm";
import { BoardCard } from "./board-card";

const FALLBACK = ["Price too high", "Chose competitor", "No budget", "No response", "Not a fit", "Postponed", "Other"];

/**
 * Lost leads, one column per reason, so the pattern is plain at a glance: are we losing on price, on silence, to a
 * competitor? Each card opens the lead (history, last quote) for a win-back.
 */
export function LostBoard({ leads, reasons, showOwner }: { leads: Lead[]; reasons?: string[]; showOwner: boolean }) {
  const router = useRouter();
  const cols = reasons?.length ? reasons : FALLBACK;
  const byReason = useMemo(() => {
    const map: Record<string, Lead[]> = Object.fromEntries(cols.map((r) => [r, []]));
    const other = cols.includes("Other") ? "Other" : cols[cols.length - 1];
    for (const l of leads) (map[l.lostReason && map[l.lostReason] ? l.lostReason : other] ??= []).push(l);
    return map;
  }, [leads, cols]);

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
      {cols.map((reason) => (
        <div key={reason} className="flex min-h-0 min-w-[16.5rem] flex-1 flex-col rounded-2xl bg-red-50/60 p-2.5">
          <div className="mb-2 flex items-center justify-between gap-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-red-700/80">
            <span className="truncate">{reason}</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-slate-600">{byReason[reason].length}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
            {byReason[reason].length === 0 && <p className="px-1 py-6 text-center text-xs text-slate-400">None</p>}
            {byReason[reason].map((l) => (
              <div key={l.id} className="space-y-1">
                <BoardCard lead={l} showOwner={showOwner} onDragStart={() => undefined} onOpen={() => router.push(dealHref(l))} />
                <p className="px-1 text-[11px] text-slate-500">Lost {formatDate(l.lastActivityAt)}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
