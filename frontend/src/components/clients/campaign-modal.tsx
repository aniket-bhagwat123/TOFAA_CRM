"use client";
import { Megaphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select-field";
import { useApi } from "@/hooks/use-api";
import { formatDate, todayIso } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import type { CalendarDate, Campaign } from "@/types/crm";

/**
 * "Call every client before Diwali": every client who has the occasion on their card, or who ordered for it before, gets
 * a dated call on their owner's Today screen. Progress shows here as people log the outcomes.
 */
export function CampaignModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const calendar = useApi<CalendarDate[]>(open ? "/occasion-calendar" : null);
  const campaigns = useApi<Campaign[]>(open ? "/campaigns" : null);
  const upcoming = (calendar.data ?? []).filter((c) => c.occursOn >= todayIso());
  const [pick, setPick] = useState("");
  const [due, setDue] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => { if (!open) { setPick(""); setDue(todayIso()); setError(undefined); } }, [open]);

  async function start() {
    const entry = upcoming.find((c) => c.id === pick);
    if (!entry) return setError("Pick the occasion");
    setBusy(true);
    try {
      const res = await apiClient.post<{ targets: number; name: string }>("/campaigns", { occasion: entry.name, occursOn: entry.occursOn, dueDate: due });
      toast.success(`${res.data.name}: ${res.data.targets} clients to call. They are on their owners' Today screens.`);
      setPick("");
      void campaigns.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Occasion campaign" subtitle="Call every client before a big occasion" icon={Megaphone} tone="violet" width="md">
      <div className="space-y-4">
        <SelectField label="Occasion" required placeholder="Choose" value={pick} options={upcoming.map((c) => ({ value: c.id, label: `${c.name} · ${formatDate(c.occursOn)}` }))} onChange={(e) => { setPick(e.target.value); setError(undefined); }} error={error} />
        <DatePicker label="Calls due on" required min={todayIso()} value={due} onChange={setDue} />
        <Button onClick={start} loading={busy} className="w-full">Start campaign</Button>
        {(campaigns.data?.length ?? 0) > 0 && (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-700">Campaigns</h3>
            {campaigns.data!.map((c) => {
              const called = c.total - c.counts.pending;
              return (
                <div key={c.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between text-sm"><span className="font-medium">{c.name}</span><span className="text-slate-500">{called} of {c.total} called</span></div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand" style={{ width: `${c.total ? (called / c.total) * 100 : 0}%` }} /></div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    <span className="text-emerald-600">{c.counts.interested} interested</span><span>{c.counts.not_now} not now</span><span>{c.counts.no_answer} no answer</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
