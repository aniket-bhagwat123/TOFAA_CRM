"use client";
/** The OMS handover of an order: where it stands, what is missing, approval, and what OMS reports back. */
import { Check, PackageOpen, Pencil, Send, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextareaField } from "@/components/ui/input-field";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { Handover, HandoverStatus } from "@/types/orders";

const STATUS: Record<HandoverStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-slate-100 text-slate-600" },
  pending_approval: { label: "Waiting for approval", tone: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", tone: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", tone: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", tone: "bg-slate-200 text-slate-600" },
};
const words = (value: string) => value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const when = (value: string) => `${formatDate(value)}, ${formatTime(value).toUpperCase()}`;

export function HandoverPanel({ orderId, onChanged }: { orderId: string; onChanged: () => void }) {
  const api = useApi<Handover>(`/orders/by-id/${orderId}/handover`);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<"reject" | "cancel" | null>(null);
  const [note, setNote] = useState("");
  const h = api.data;

  if (api.error && !h) return <Card className="p-4 text-sm text-slate-500">{api.error}</Card>;
  if (!h || !h.applies || !h.status) return null;

  async function run(call: () => Promise<{ data: Handover }>, done: string) {
    setBusy(true);
    try {
      const res = await call();
      api.setData(res.data);
      setAsking(null);
      setNote("");
      toast.success(done);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
      void api.reload();
    } finally { setBusy(false); }
  }
  const base = `/orders/by-id/${orderId}/handover`;
  const decide = (approve: boolean) => void run(() => apiClient.post<Handover>(`${base}/decision`, { approve, version: h.version, submittedAt: h.submittedAt, note: note.trim() || null }), approve ? "Approved. OMS can read it now." : "Rejected");

  const status = STATUS[h.status];
  const seen = h.publishedStatus === "approved";
  const f = h.form;
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <PackageOpen className="h-5 w-5 text-brand" />Handover {h.handoverNumber && <span className="font-mono">{h.handoverNumber}</span>}
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", status.tone)}>{status.label}</span>
          {h.version > 0 && <span className="text-xs font-medium text-slate-500">Handover Version {h.version} sent to OMS</span>}
        </h2>
        <div className="flex flex-wrap gap-2">
          {h.canEdit && <Link href={`/deals/${orderId}/handover`} className="pressable inline-flex min-h-[2.5rem] items-center gap-2 rounded-xl border border-slate-300/80 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Pencil className="h-4 w-4" />Edit handover</Link>}
          {h.canSubmit && <Button loading={busy} disabled={h.problems.length > 0} onClick={() => void run(() => apiClient.post<Handover>(`${base}/submit`), "Sent for approval")}><Send className="h-4 w-4" />Send for approval</Button>}
          {h.canDecide && <>
            <Button variant="secondary" disabled={busy} onClick={() => { setNote(""); setAsking("reject"); }}><X className="h-4 w-4" />Reject</Button>
            <Button loading={busy} onClick={() => decide(true)}><Check className="h-4 w-4" />Approve</Button>
          </>}
          {h.canCancel && <Button variant="ghost" className="text-red-600 hover:bg-red-50" disabled={busy} onClick={() => { setNote(""); setAsking("cancel"); }}>Cancel handover</Button>}
        </div>
      </div>

      {h.note && (h.status === "rejected" || h.status === "cancelled") && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-800">{h.note}</p>}
      {seen && (h.status === "draft" || h.status === "rejected" || h.status === "pending_approval") && <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">There are changes that are not approved. OMS still works from version {h.version}.</p>}
      {h.canEdit && h.problems.length > 0 && (
        <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <p className="font-medium">Before sending for approval:</p>
          <ul className="mt-1 list-disc pl-5">{h.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        {([["Kit Quantity", f.totalKits], ["Requested Delivery Date", f.expectedDelivery ? formatDate(f.expectedDelivery) : ""], ["Bulk Advance", f.advancePercent == null ? "" : `${f.advancePercent}%`],
          ["Elements per Kit", f.items.length || ""], ["Delivery Locations", f.deliveryLocations.length || ""], ["Sample Required", f.sample.required == null ? "" : !f.sample.required ? "No" : f.sample.approvedOn ? `Yes, approved ${formatDate(f.sample.approvedOn)}` : "Yes, not approved yet"],
          ["Order Number", h.oms.orderNumber], ["Order Status", h.oms.stage ? `${words(h.oms.stage)}${h.oms.changedAt ? ` · ${when(h.oms.changedAt)}` : ""}` : ""], ["Ops Date Confirmation", h.oms.confirmedDeadline ? `Committed Delivery Date ${formatDate(h.oms.confirmedDeadline)}` : ""],
        ] as const).map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="font-medium text-slate-900">{value || "—"}</dd></div>)}
      </dl>

      {h.oms.shipments.length > 0 && (
        <div className="space-y-1.5 border-t border-slate-200 pt-3">
          <h3 className="text-sm font-semibold text-slate-800">Shipments</h3>
          <ul className="space-y-1 text-sm text-slate-700">
            {h.oms.shipments.map((s, i) => {
              const at = f.deliveryLocations.find((p) => p.locationRef === s.locationRef);
              return <li key={i}>{[at?.city ?? s.locationRef, s.kits ? `${s.kits} kits` : "", s.transporter, s.trackingNumber, s.deliveredAt ? `delivered ${formatDate(s.deliveredAt)}` : s.dispatchedAt ? `dispatched ${formatDate(s.dispatchedAt)}` : ""].filter(Boolean).join(" · ")}</li>;
            })}
          </ul>
        </div>
      )}

      <Sheet open={!!asking} title={asking === "cancel" ? "Cancel this handover" : "Reject this handover"} subtitle={h.handoverNumber ?? h.orderNumber} icon={X} tone="red" onClose={() => setAsking(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-500">{asking === "reject" ? "The KAM sees your reason, changes the handover and sends it again." : seen || h.version > 0 ? "OMS is told it is cancelled and its Super Admin decides. This cannot be undone." : "The deal is cancelled. This cannot be undone."}</p>
          <TextareaField label="Reason" required maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="danger" className="w-full" loading={busy} disabled={!note.trim()}
            onClick={() => (asking === "reject" ? decide(false) : void run(() => apiClient.post<Handover>(`${base}/cancel`, { note: note.trim() }), "Handover cancelled"))}>
            {asking === "cancel" ? "Cancel handover" : "Reject"}
          </Button>
        </div>
      </Sheet>
    </Card>
  );
}
