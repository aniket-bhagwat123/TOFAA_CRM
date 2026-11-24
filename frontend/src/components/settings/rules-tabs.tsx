"use client";
import { CheckCircle2, CircleAlert, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputField } from "@/components/ui/input-field";
import { Spinner } from "@/components/ui/spinner";
import { useApi } from "@/hooks/use-api";
import { fieldErrors } from "@/lib/api-errors";
import { formatDateTime } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";

export type AppSettings = {
  retry: { maxAttempts: number; gapDays: number };
  nurtureDays: number;
  stuckDays: number;
  lostReasons: string[];
  sources: string[];
  erp: { configured: boolean; fallbackEnabled: boolean; lastConfirmationAt?: string | null; lastInvoice?: string | null };
};

async function save(body: Partial<AppSettings>, done: () => void) {
  try {
    await apiClient.put("/app-settings", body);
    toast.success("Settings saved");
    done();
  } catch (e) {
    const fe = fieldErrors(e);
    toast.error(Object.values(fe)[0] ?? errorMessage(e));
  }
}

/** Retry rules, Nurture days and stuck-deal days. */
export function RulesTab() {
  const s = useApi<AppSettings>("/app-settings");
  const [v, setV] = useState({ maxAttempts: "", gapDays: "", nurtureDays: "", stuckDays: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (s.data) setV({ maxAttempts: String(s.data.retry.maxAttempts), gapDays: String(s.data.retry.gapDays), nurtureDays: String(s.data.nurtureDays), stuckDays: String(s.data.stuckDays) });
  }, [s.data]);
  if (!s.data) return <div className="flex justify-center py-10"><Spinner /></div>;

  const num = (k: keyof typeof v) => ({ type: "number", integer: true, value: v[k], onChange: (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value })) });
  return (
    <Card className="space-y-5">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Retry rules</h3>
          <p className="text-xs text-slate-500">After this many "Not reachable" calls a lead is tagged Cold (filter it in Leads). The gap is the default "Call again on" date.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Attempts before Cold" {...num("maxAttempts")} />
          <InputField label="Days between attempts" {...num("gapDays")} />
        </div>
      </section>
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Nurture and stuck deals</h3>
          <p className="text-xs text-slate-500">A "Future requirement" lead's follow-up defaults to this many days later. A deal with no progress for the stuck days shows on the Dashboard.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Nurture days" {...num("nurtureDays")} />
          <InputField label="Stuck after (days)" {...num("stuckDays")} />
        </div>
      </section>
      <Button loading={busy} onClick={async () => {
        setBusy(true);
        await save({ retry: { maxAttempts: Number(v.maxAttempts), gapDays: Number(v.gapDays) }, nurtureDays: Number(v.nurtureDays), stuckDays: Number(v.stuckDays) }, () => void s.reload());
        setBusy(false);
      }}>Save rules</Button>
    </Card>
  );
}

function ListEditor({ title, hint, items, onSave }: { title: string; hint: string; items: string[]; onSave: (list: string[]) => Promise<void> }) {
  const [list, setList] = useState(items);
  const [added, setAdded] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setList(items), [items]);
  const add = () => { const x = added.trim(); if (x && !list.includes(x)) setList((l) => [...l, x]); setAdded(""); };
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {list.map((x) => (
          <li key={x} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white py-1 pl-3 pr-1 text-sm text-slate-700">
            {x}
            <button type="button" aria-label={`Remove ${x}`} onClick={() => setList((l) => l.filter((y) => y !== x))} className="pressable flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <div className="flex-1"><InputField hideLabel label={`New ${title.toLowerCase()}`} placeholder="Add one" maxLength={60} value={added} onChange={(e) => setAdded(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} /></div>
        <Button variant="secondary" onClick={add}><Plus className="h-4 w-4" /> Add</Button>
        <Button loading={busy} disabled={!list.length} onClick={async () => { setBusy(true); await onSave(list); setBusy(false); }}>Save</Button>
      </div>
    </section>
  );
}

/** Lost reasons and lead sources, editable. */
export function ListsTab() {
  const s = useApi<AppSettings>("/app-settings");
  if (!s.data) return <div className="flex justify-center py-10"><Spinner /></div>;
  return (
    <Card className="space-y-6">
      <ListEditor title="Lost reasons" hint="Offered when a lead is closed as lost. Existing leads keep the reason they were given." items={s.data.lostReasons}
        onSave={(list) => save({ lostReasons: list }, () => void s.reload())} />
      <ListEditor title="Lead sources" hint="Offered when a lead is added and in the Leads filter." items={s.data.sources}
        onSave={(list) => save({ sources: list }, () => void s.reload())} />
    </Card>
  );
}

/** Whether the ERP can confirm payments, and when it last did. */
export function ErpTab() {
  const s = useApi<AppSettings>("/app-settings");
  if (!s.data) return <div className="flex justify-center py-10"><Spinner /></div>;
  const erp = s.data.erp;
  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        {erp.configured ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />}
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{erp.configured ? "ERP connection is set up" : "ERP connection is not set up"}</h3>
          <p className="text-sm text-slate-500">
            {erp.configured
              ? "The ERP can confirm payments by itself (signed callbacks to /api/v1/payments/erp-webhook)."
              : "Add ERP_WEBHOOK_SECRET on the server and give the same secret to the ERP. Until then Finance confirms payments by hand."}
          </p>
        </div>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Last payment confirmed by the ERP</dt><dd className="mt-0.5 font-medium text-slate-800">{erp.lastConfirmationAt ? `${formatDateTime(erp.lastConfirmationAt)}${erp.lastInvoice ? ` · ${erp.lastInvoice}` : ""}` : "None yet"}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Finance "Confirm payment" button</dt><dd className="mt-0.5 font-medium text-slate-800">{erp.fallbackEnabled ? "On (PAYMENT_FALLBACK_ENABLED)" : "Off: only the ERP confirms"}</dd></div>
      </dl>
    </Card>
  );
}
