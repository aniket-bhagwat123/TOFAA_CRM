"use client";
import { ChevronLeft, ChevronRight, Target } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/ui/avatar";
import { useApi } from "@/hooks/use-api";
import { inrShort } from "@/lib/money";
import { cleanNumber } from "@/components/ui/input-field";
import { apiClient, errorMessage } from "@/services/api-client";
import type { TargetMember } from "@/types/crm";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const shift = (m: string, by: number) => ym(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1));

type Props = { open: boolean; onClose: () => void; onSaved: () => void };
type Draft = { target: string; discount: string };

/** Monthly target and discount limit for each KAM. A value carries forward to later months until someone changes it. */
export function TargetsModal({ open, onClose, onSaved }: Props) {
  const [month, setMonth] = useState(ym(new Date()));
  const list = useApi<{ month: string; members: TargetMember[] }>(open ? "/targets" : null, { month });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { setDrafts({}); }, [month, list.data]);
  useEffect(() => { if (!open) setMonth(ym(new Date())); }, [open]);

  const val = (m: TargetMember): Draft => drafts[m.userId] ?? { target: String(m.targetAmount || ""), discount: String(m.discountLimit || "") };
  const dirty = (m: TargetMember) => !!drafts[m.userId] && (Number(drafts[m.userId].target || 0) !== m.targetAmount || Number(drafts[m.userId].discount || 0) !== m.discountLimit);

  async function save(m: TargetMember) {
    const d = val(m);
    const discount = Number(d.discount || 0);
    if (discount > 100) return toast.error("Discount limit cannot be more than 100%");
    setBusy(m.userId);
    try {
      await apiClient.put("/targets", { userId: m.userId, month, targetAmount: Number(d.target || 0), discountLimit: discount });
      toast.success(`Saved for ${m.fullName}`);
      await list.reload();
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const input = "h-10 w-full rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15";
  const label = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

  return (
    <Modal open={open} onClose={onClose} title="Targets and discount limits" subtitle="Set per KAM, for each month" icon={Target} tone="violet" width="lg">
      <div className="mb-4 flex items-center justify-center gap-3">
        <button type="button" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month" className="pressable rounded-full p-2 text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
        <span className="min-w-36 text-center text-sm font-semibold">{label}</span>
        <button type="button" onClick={() => setMonth(shift(month, 1))} aria-label="Next month" className="pressable rounded-full p-2 text-slate-500 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
      </div>
      {list.loading && !list.data && <TableSkeleton columns={3} rows={4} />}
      {list.error && !list.data && <p className="text-sm text-red-600">{list.error}</p>}
      {list.data && list.data.members.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No KAMs to set targets for yet.</p>}
      {list.data && list.data.members.length > 0 && (
        <div className="space-y-2">
          <div className="hidden grid-cols-[1fr_9rem_7rem_6rem_5rem] gap-3 px-2 text-[12px] font-medium uppercase tracking-wide text-slate-400 sm:grid">
            <span>KAM</span><span>Target (₹)</span><span>Discount limit (%)</span><span>Won so far</span><span />
          </div>
          {list.data.members.map((m) => {
            const d = val(m);
            return (
              <div key={m.userId} className="grid items-center gap-3 rounded-2xl border border-slate-200 p-3 sm:grid-cols-[1fr_9rem_7rem_6rem_5rem]">
                <div className="flex min-w-0 items-center gap-2.5"><Avatar name={m.fullName} size="xs" /><span className="truncate text-sm font-medium">{m.fullName}</span></div>
                <input aria-label={`Target for ${m.fullName}`} inputMode="decimal" className={input} value={d.target} placeholder="Enter target" onChange={(e) => setDrafts((x) => ({ ...x, [m.userId]: { ...d, target: cleanNumber(e.target.value) } }))} />
                <input aria-label={`Discount limit for ${m.fullName}`} inputMode="decimal" className={input} value={d.discount} placeholder="Enter limit" onChange={(e) => setDrafts((x) => ({ ...x, [m.userId]: { ...d, discount: cleanNumber(e.target.value) } }))} />
                <div className="text-sm text-slate-600">{inrShort(m.won)}</div>
                <Button variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" disabled={!dirty(m)} loading={busy === m.userId} onClick={() => save(m)}>Save</Button>
              </div>
            );
          })}
          <p className="px-1 pt-2 text-xs text-slate-400">A value set for one month carries forward until it is changed. A KAM's quotation discount above their limit goes to their manager for approval.</p>
        </div>
      )}
    </Modal>
  );
}
