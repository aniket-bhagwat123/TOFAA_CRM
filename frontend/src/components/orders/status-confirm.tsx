"use client";
/** "Move this order to …?": the stage's icon, where the order is and where it goes, No / Yes. Used by Orders and the order page. */
import { ArrowRight, Ban, ClipboardCheck, Factory, FileText, Package, PackageCheck, PauseCircle, Send, ThumbsUp, Truck, XCircle, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { TextareaField } from "@/components/ui/input-field";
import { NEEDS_NOTE, orderStatus } from "@/lib/order-status";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/types/orders";

// The big icon and its colour, per stage.
const STAGE: Record<OrderStatus, { icon: LucideIcon; tone: string }> = {
  new: { icon: FileText, tone: "bg-slate-100 text-slate-600 ring-slate-50" },
  ready: { icon: Send, tone: "bg-indigo-100 text-indigo-600 ring-indigo-50" },
  accepted: { icon: ThumbsUp, tone: "bg-blue-100 text-blue-600 ring-blue-50" },
  production: { icon: Factory, tone: "bg-amber-100 text-amber-600 ring-amber-50" },
  quality_check: { icon: ClipboardCheck, tone: "bg-violet-100 text-violet-600 ring-violet-50" },
  packed: { icon: Package, tone: "bg-teal-100 text-teal-600 ring-teal-50" },
  dispatched: { icon: Truck, tone: "bg-sky-100 text-sky-600 ring-sky-50" },
  delivered: { icon: PackageCheck, tone: "bg-emerald-100 text-emerald-600 ring-emerald-50" },
  on_hold: { icon: PauseCircle, tone: "bg-orange-100 text-orange-600 ring-orange-50" },
  rejected: { icon: XCircle, tone: "bg-red-100 text-red-600 ring-red-50" },
  cancelled: { icon: Ban, tone: "bg-red-100 text-red-600 ring-red-50" },
};
// Short names, as on the Orders screen.
const SHORT: Partial<Record<OrderStatus, string>> = { production: "Production", quality_check: "Quality check" };
const nameOf = (status: OrderStatus) => SHORT[status] ?? orderStatus(status).label;

type Props = {
  target: { from: OrderStatus; to: OrderStatus; orderNumber?: string; company: string } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
};

export function StatusConfirm({ target, busy, onCancel, onConfirm }: Props) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const key = target ? `${target.orderNumber}:${target.to}` : "";
  useEffect(() => { setNote(""); setError(""); }, [key]);
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, busy, onCancel]);
  if (!target) return null;
  const to = STAGE[target.to];
  const from = STAGE[target.from];
  const ToIcon = to.icon;
  const FromIcon = from.icon;
  const needsNote = NEEDS_NOTE.includes(target.to);
  const yes = () => (needsNote && !note.trim() ? setError("Add a short note saying why.") : onConfirm(note));

  // Drawn on <body>, so the overlay covers the whole screen whatever the page layout around it does.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex h-dvh w-screen items-center justify-center bg-slate-900/40 p-4" onClick={() => !busy && onCancel()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-step-title" onClick={(e) => e.stopPropagation()}
        className="max-h-full w-full max-w-sm space-y-5 overflow-y-auto rounded-3xl bg-white p-6 text-center shadow-sheet">
        <span className={cn("mx-auto flex h-14 w-14 items-center justify-center rounded-full ring-8", to.tone)}>
          <ToIcon className="h-7 w-7" />
        </span>

        <div className="space-y-2">
          <p id="confirm-step-title" className="text-base font-semibold text-slate-900">Move this order to {nameOf(target.to)}?</p>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
            {target.orderNumber && <span className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 font-mono text-sm font-bold text-slate-800">#{target.orderNumber}</span>}
            <span className="truncate">{target.company}</span>
          </div>
        </div>

        {/* just the two stages: where the order is now, and where it goes */}
        <div className="flex items-center justify-center gap-3" aria-label="Stage change">
          <div className="flex w-24 flex-col items-center gap-1.5">
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-full text-white", target.from === "new" ? "bg-slate-300" : "bg-[rgb(34_115_166)]")}>
              <FromIcon className="h-4 w-4" />
            </span>
            <span className="text-xs font-medium text-slate-500">{nameOf(target.from)}</span>
          </div>
          <ArrowRight className="mb-5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="flex w-24 flex-col items-center gap-1.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white ring-4 ring-brand/20">
              <ToIcon className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-slate-900">{nameOf(target.to)}</span>
          </div>
        </div>

        {needsNote && <div className="text-left"><TextareaField label="Reason" required rows={3} maxLength={500} value={note} error={error} onChange={(e) => { setNote(e.target.value); setError(""); }} /></div>}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>No</Button>
          <Button variant={target.to === "cancelled" ? "danger" : "primary"} onClick={yes} loading={busy}>Yes</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
