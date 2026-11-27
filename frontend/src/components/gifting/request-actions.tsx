"use client";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { apiClient, errorMessage } from "@/services/api-client";
import type { GiftAction, GiftRequestDetail } from "@/types/gifting";

const ACTIONS: Record<GiftAction, { label: string; done: string; ask?: string }> = {
  start_review: { label: "Start review", done: "Moved to review" },
  publish_proposal: { label: "Send proposal", done: "Proposal sent to the client" },
  request_info: { label: "Ask for information", done: "Information requested", ask: "What do you need from the client?" },
  reject: { label: "Reject", done: "Request rejected", ask: "Why is this request rejected?" },
  start_fulfilment: { label: "Start fulfilment", done: "Request is in progress" },
  send_to_oms: { label: "Send to OMS", done: "Sent to OMS" },
  dispatch: { label: "Mark dispatched", done: "Marked as dispatched" },
  deliver: { label: "Mark delivered", done: "Marked as delivered" },
};
type Row = { name: string; description: string; price: string };
const EMPTY: Row = { name: "", description: "", price: "" };

/** What the KAM can do with this request now. Every step is confirmed before it is sent to Gifting OS. */
export function RequestActions({ requestId, allowed, onDone }: { requestId: string; allowed: GiftAction[]; onDone: (d: GiftRequestDetail) => void }) {
  const [chosen, setChosen] = useState<GiftAction | null>(null);
  const [note, setNote] = useState("");
  const [options, setOptions] = useState<Row[]>([EMPTY]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = (a: GiftAction | null) => { setChosen(a); setNote(""); setOptions([EMPTY]); setError(""); };
  const change = (i: number, patch: Partial<Row>) => { setOptions((o) => o.map((r, n) => (n === i ? { ...r, ...patch } : r))); setError(""); };

  async function send() {
    if (!chosen) return;
    if (ACTIONS[chosen].ask && !note.trim()) return setError("Please write a note for the client.");
    const proposal = chosen === "publish_proposal"
      ? { note: note.trim() || undefined, options: options.map((o) => ({ name: o.name.trim(), description: o.description.trim() || undefined, price: Number(o.price) })) }
      : undefined;
    if (proposal && options.some((o) => !o.name.trim() || o.price.trim() === "" || !(Number(o.price) >= 0))) return setError("Every option needs a name and a price.");
    setBusy(true);
    try {
      const res = await apiClient.post<GiftRequestDetail>(`/gifting-requests/${requestId}/actions`, { action: chosen, note: note.trim() || undefined, proposal });
      toast.success(ACTIONS[chosen].done);
      pick(null);
      onDone(res.data);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!allowed.length) return null;
  return (
    <section className="space-y-3 text-sm">
      {!chosen ? (
        <div className="flex flex-wrap gap-2">
          {allowed.map((a, i) => <Button key={a} variant={a === "reject" ? "secondary" : i ? "secondary" : "primary"} className={a === "reject" ? "text-red-600" : undefined} onClick={() => pick(a)}>{ACTIONS[a].label}</Button>)}
        </div>
      ) : (
        <>
          <h3 className="font-semibold text-slate-900">{ACTIONS[chosen].label}</h3>
          {chosen === "publish_proposal" && (
            <div className="space-y-3">
              {options.map((o, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">Option {i + 1}</span>
                    {options.length > 1 && <button type="button" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions((x) => x.filter((_, n) => n !== i))} className="pressable rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                  <InputField label="Gift name" required maxLength={180} value={o.name} onChange={(e) => change(i, { name: e.target.value })} />
                  <InputField label="Price (₹)" required inputMode="decimal" value={o.price} onChange={(e) => change(i, { price: e.target.value.replace(/[^0-9.]/g, "") })} />
                  <InputField label="Description" maxLength={1000} value={o.description} onChange={(e) => change(i, { description: e.target.value })} />
                </div>
              ))}
              {options.length < 20 && <Button variant="secondary" onClick={() => setOptions((x) => [...x, EMPTY])}><Plus className="h-4 w-4" />Add option</Button>}
            </div>
          )}
          {(ACTIONS[chosen].ask || chosen === "publish_proposal") && (
            <label className="block space-y-1">
              <span className="font-medium text-slate-700">{ACTIONS[chosen].ask ?? "Note to the client (optional)"}</span>
              <textarea rows={3} maxLength={2000} value={note} onChange={(e) => { setNote(e.target.value); setError(""); }}
                className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 outline-none focus:border-brand focus:ring-4 focus:ring-brand/15" />
            </label>
          )}
          {!ACTIONS[chosen].ask && chosen !== "publish_proposal" && <p className="text-slate-600">{chosen === "send_to_oms" ? "The order goes to OMS and the request moves to In progress." : "The client sees the new status in Gifting OS."}</p>}
          {error && <p role="alert" className="text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => pick(null)}>Cancel</Button>
            <Button variant={chosen === "reject" ? "danger" : "primary"} loading={busy} onClick={() => void send()}>{ACTIONS[chosen].label}</Button>
          </div>
        </>
      )}
    </section>
  );
}
