"use client";
import { Flag, ThumbsDown, Trophy } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { LeadTarget } from "./types";

type Props = { target: LeadTarget | null; canMarkWon: boolean; onWon: (t: LeadTarget) => void; onLost: (t: LeadTarget) => void; onClose: () => void };

/** Two clear outcomes. Won is set by payment confirmation, so only an admin can set it by hand. */
export function CloseLeadSheet({ target, canMarkWon, onWon, onLost, onClose }: Props) {
  const choose = (fn: (t: LeadTarget) => void) => () => {
    if (!target) return;
    const t = target;
    onClose();
    fn(t);
  };
  return (
    <Sheet open={!!target} title="Close this lead" subtitle={target?.name} icon={Flag} tone="amber" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">How did <b className="text-slate-700">{target?.name}</b> end?</p>
        <button
          type="button"
          disabled={!canMarkWon}
          onClick={choose(onWon)}
          className={cn("pressable flex w-full items-start gap-4 rounded-2xl border p-4 text-left", canMarkWon ? "border-emerald-200 bg-emerald-50 hover:border-emerald-400" : "cursor-not-allowed border-slate-200 bg-slate-50 opacity-70")}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white"><Trophy className="h-5 w-5" /></span>
          <span>
            <span className="block font-semibold text-slate-900">Won</span>
            <span className="block text-sm text-slate-600">{canMarkWon ? "The client has paid and the deal is done." : "Set automatically when Finance or the ERP confirms the payment."}</span>
          </span>
        </button>
        <button type="button" onClick={choose(onLost)} className="pressable flex w-full items-start gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-left hover:border-red-400">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500 text-white"><ThumbsDown className="h-5 w-5" /></span>
          <span>
            <span className="block font-semibold text-slate-900">Lost</span>
            <span className="block text-sm text-slate-600">The client will not go ahead. You will pick a reason next.</span>
          </span>
        </button>
      </div>
    </Sheet>
  );
}
