"use client";
import { Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { Sheet } from "@/components/ui/sheet";
import { formatDate } from "@/lib/format";
import { inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { Lead, Quotation } from "@/types/crm";

type Props = { clientId: string | null; clientName?: string; projects: Lead[]; onClose: () => void; onDone: (projectId: string, quotation: Quotation) => void };

/** "Same as last time": pick an earlier project; its items go straight into a new quotation, ready to send. */
export function RepeatSheet({ clientId, clientName, projects, onClose, onDone }: Props) {
  const won = projects.filter((p) => p.stage === "closed_won");
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (clientId) setSource(won[0]?.id ?? ""); else setTitle(""); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!clientId || !source) return;
    setBusy(true);
    try {
      const res = await apiClient.post<{ projectId: string; quotation: Quotation }>(`/clients/${clientId}/projects/repeat`, { sourceProjectId: source, title: title.trim() || null });
      toast.success("Repeat project ready with last time's items");
      onClose();
      onDone(res.data.projectId, res.data.quotation);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!clientId} title="Repeat an order" subtitle={clientName} icon={Repeat} tone="emerald" onClose={onClose}>
      <div className="space-y-4">
        {won.length === 0 ? (
          <p className="text-sm text-slate-500">There is no won project to repeat yet.</p>
        ) : (
          <>
            <div className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Repeat which order?<span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span></span>
              {won.map((p) => (
                <button key={p.id} type="button" onClick={() => setSource(p.id)} aria-pressed={source === p.id}
                  className={cn("pressable flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left", source === p.id ? "border-brand bg-brand-soft" : "border-slate-200 hover:bg-slate-50")}>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.projectTitle ?? "Order"}</span><span className="text-xs text-slate-400">{p.occasion ?? "No occasion"} · {formatDate(p.createdAt)}</span></span>
                  <span className="shrink-0 text-sm font-semibold">{inrShort(p.dealValue)}</span>
                </button>
              ))}
            </div>
            <InputField label="New project name (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter project name" />
            <p className="text-xs text-slate-400">The new quotation copies the items, prices and discount. You can change it before sending.</p>
            <Button onClick={save} loading={busy} disabled={!source} className="w-full"><Repeat className="h-4 w-4" /> Create repeat project</Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
