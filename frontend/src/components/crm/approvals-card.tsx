"use client";
import { BadgeCheck, Check, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { formatDate } from "@/lib/format";
import { inr } from "@/lib/money";
import { apiClient, errorMessage } from "@/services/api-client";
import type { Approval } from "@/types/crm";
import { VoiceTextarea } from "./voice-textarea";

type Props = { items: Approval[]; onChanged: () => void };

/** Quotations whose discount is above the executive's limit. Approve, or reject with a reason, in one step. */
export function ApprovalsCard({ items, onChanged }: Props) {
  const [rejecting, setRejecting] = useState<Approval | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(a: Approval, approve: boolean, why?: string) {
    setBusy(a.id);
    try {
      await apiClient.post(`/quotations/${a.id}/decision`, { approve, note: why?.trim() || null });
      toast.success(approve ? "Approved. The executive can send it now." : "Rejected");
      setRejecting(null); setNote("");
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) return null;
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><BadgeCheck className="h-4 w-4 text-amber-500" /> Discounts waiting for approval <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{items.length}</span></h2>
      {items.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200/70 bg-amber-50/40 p-3">
          <div className="min-w-0">
            <Link href={`/leads/${a.leadId}`} className="font-medium text-slate-900 hover:text-brand">{a.companyName}</Link>
            <div className="text-xs text-slate-500">{a.number} · {inr(a.total)} · <b className="text-amber-700">{a.discountPct}% discount</b> (limit {a.discountLimit ?? 0}%) · {a.author?.fullName ?? "—"} · {formatDate(a.createdAt)}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" disabled={busy === a.id} onClick={() => { setRejecting(a); setNote(""); }}><X className="h-3.5 w-3.5" /> Reject</Button>
            <Button className="min-h-9 px-3 py-1.5 text-xs" loading={busy === a.id} onClick={() => decide(a, true)}><Check className="h-3.5 w-3.5" /> Approve</Button>
          </div>
        </div>
      ))}

      <Sheet open={!!rejecting} title="Reject this discount" subtitle={rejecting?.companyName} icon={X} tone="red" onClose={() => setRejecting(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-500">The executive will see your reason and can make a new version with a lower discount.</p>
          <VoiceTextarea label="Reason (optional)" value={note} onChange={setNote} rows={3} placeholder="Write the reason" />
          <Button variant="danger" className="w-full" loading={busy === rejecting?.id} onClick={() => rejecting && decide(rejecting, false, note)}>Reject</Button>
        </div>
      </Sheet>
    </Card>
  );
}
