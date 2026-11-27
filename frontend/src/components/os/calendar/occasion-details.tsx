"use client";
import { Building2, CalendarDays, ChevronDown, Gift, Pencil, Repeat, Star, StickyNote, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { metaOf } from "@/components/gifting/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OverviewItem } from "@/types/os-modules";
import { actionFor, countdownText, fullDay, kindMeta, StatusPill, Subject, WINDOW_DAYS, type ActionKind } from "./meta";
import { SidePanel } from "./side-panel";

const PRIORITY_CHIP = { NORMAL: "bg-slate-100 text-slate-700", HIGH: "bg-orange-50 text-orange-700", VIP: "bg-violet-50 text-violet-700" } as const;
const PRIORITY_LABEL = { NORMAL: "Normal", HIGH: "High", VIP: "VIP" } as const;

type Props = {
  item: OverviewItem; canRequest: boolean; onClose: () => void; onAct: (item: OverviewItem, kind: ActionKind) => void;
  onEdit?: () => void; onDelete?: () => void;
};

/** One occasion in full: who, when, where it stands, the requests made from it, and what to do next. */
export function OccasionDetails({ item, canRequest, onClose, onAct, onEdit, onDelete }: Props) {
  const [more, setMore] = useState(false);
  const action = actionFor(item, canRequest);
  const { icon: Icon, tint } = kindMeta(item.kind);
  const who = item.sourceType === "COMPANY" ? (item.isGlobal ? "TOFAA occasion" : "Company Event") : item.relationship ?? item.label;
  const row = "flex items-center justify-between gap-3";
  const term = "flex items-center gap-2.5 text-slate-700";

  return (
    <SidePanel label={item.name} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <div className="flex items-start gap-4">
          <Subject item={item} large />
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="truncate text-xl font-bold capitalize text-slate-900">{item.name}</h2>
            <p className="truncate text-sm text-slate-500">{[who, item.accountName].filter(Boolean).join(" · ")}</p>
            <div className="mt-2"><StatusPill status={item.status} /></div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"><X size={20} /></button>
        </div>

        <div className="flex items-center gap-4 rounded-2xl bg-brand-soft p-4">
          <span aria-hidden="true" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tint)}><Icon size={20} /></span>
          <div><p className="text-sm text-slate-700">{item.label}</p><p className="text-xl font-bold text-slate-900">{fullDay(item.date)}</p><p className={cn("text-sm", item.daysAway >= 0 && item.daysAway <= 7 ? "font-medium text-amber-700" : "text-slate-500")}>{countdownText(item.daysAway)}</p></div>
        </div>

        {item.description && <section><h3 className="text-sm font-semibold text-slate-900">About this occasion</h3><p className="mt-1 text-sm text-slate-700">{item.description}</p></section>}

        {item.status ? (
          <>
            <section className="border-t border-slate-200 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Planning details</h3>
              <dl className="space-y-3 text-sm">
                <div className={row}><dt className={term}><Star size={16} aria-hidden />Priority</dt><dd><span className={cn("rounded-full px-3 py-1 text-xs font-semibold", PRIORITY_CHIP[item.priority ?? "NORMAL"])}>{PRIORITY_LABEL[item.priority ?? "NORMAL"]}</span></dd></div>
                <div className={row}><dt className={term}><Repeat size={16} aria-hidden />Repeat</dt><dd className="text-slate-900">{item.repeatAnnually ? "Every year" : "Does not repeat"}</dd></div>
                <div className={row}><dt className={term}><Gift size={16} aria-hidden />Budget</dt><dd className="font-semibold tabular-nums text-slate-900">{item.budget ? `₹${item.budget.toLocaleString("en-IN")}` : "—"}</dd></div>
                <div className="flex items-start justify-between gap-3"><dt className={term}><StickyNote size={16} aria-hidden />Notes</dt><dd className="max-w-[60%] break-words text-right text-slate-900">{item.notes || "—"}</dd></div>
              </dl>
            </section>
            <section className="border-t border-slate-200 pt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Gift requests</h3>
              {item.requests?.length ? (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {item.requests.map((r) => (
                    <li key={r.id}><Link href={`/gifting-requests/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-50"><span className="font-semibold text-slate-900">{r.requestCode ?? "Request"}</span><span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", metaOf(r.status).chip)}>{metaOf(r.status).label}</span></Link></li>
                  ))}
                </ul>
              ) : <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No gift request has been made for this date yet.</p>}
            </section>
          </>
        ) : <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Planning status and gift requests show for dates in the next {WINDOW_DAYS} days.</p>}

        <div className="space-y-3 pt-1">
          {action.kind !== "details" && <Button className="w-full" onClick={() => onAct(item, action.kind)}><Gift size={18} />{action.label}</Button>}
          {onEdit && <button type="button" onClick={onEdit} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-brand/60 bg-white text-base font-semibold text-brand hover:bg-brand-soft"><Pencil size={17} />Edit Occasion</button>}
          {item.sourceType === "RECIPIENT" && !item.eventId && <p className="flex items-center gap-2 text-xs text-slate-500"><CalendarDays size={14} aria-hidden />This date comes from the person&apos;s profile. Change it in People.</p>}
          {item.isGlobal && <p className="flex items-center gap-2 text-xs text-slate-500"><Building2 size={14} aria-hidden />TOFAA keeps this occasion for every client.</p>}
          {onDelete && (
            <div className="text-center">
              <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900">More options <ChevronDown size={16} className={cn("transition-transform", more && "rotate-180")} /></button>
              {more && <div className="mt-2"><button type="button" onClick={onDelete} className="pressable inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-red-700 hover:bg-red-50"><Trash2 size={15} />Delete occasion</button></div>}
            </div>
          )}
        </div>
      </div>
    </SidePanel>
  );
}
