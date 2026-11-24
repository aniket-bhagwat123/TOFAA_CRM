"use client";
import { BadgeCheck, CheckCircle2, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputField } from "@/components/ui/input-field";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { formatDate } from "@/lib/format";
import { inr } from "@/lib/money";
import { homeFor, seesPayments } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { PaymentRow } from "@/types/crm";

const TABS = [
  { key: "waiting", label: "Waiting" },
  { key: "confirmed", label: "Confirmed" },
  { key: "all", label: "All" },
] as const;
const TONE = { requested: "bg-amber-100 text-amber-800", partial: "bg-sky-100 text-sky-800", confirmed: "bg-emerald-100 text-emerald-800" };
const LABEL = { requested: "Waiting", partial: "Partly paid", confirmed: "Confirmed" };

/** Finance: invoices executives are waiting on. The ERP confirms them by itself once connected; until then, confirm here. */
export default function PaymentsPage() {
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const router = useRouter();
  const allowed = !!role && seesPayments(role);
  const list = useApi<{ items: PaymentRow[]; fallbackEnabled: boolean }>(allowed ? "/payments" : null);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("waiting");
  const [confirming, setConfirming] = useState<PaymentRow | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => { if (role && !allowed) router.replace(homeFor(role)); }, [role, allowed, router]);
  useEffect(() => { if (confirming) { setAmount(String(Math.max(confirming.amount - confirming.amountPaid, 0))); setError(undefined); } }, [confirming]);
  if (!allowed) return null;

  const items = (list.data?.items ?? []).filter((p) => (tab === "waiting" ? p.status !== "confirmed" : tab === "confirmed" ? p.status === "confirmed" : true));
  const fallback = list.data?.fallbackEnabled ?? true;

  async function confirm() {
    if (!confirming) return;
    if (!(Number(amount) > 0)) return setError("Enter the amount received");
    setBusy(true);
    try {
      await apiClient.post(`/payments/${confirming.id}/confirm`, { amount: Number(amount) });
      toast.success("Payment recorded");
      setConfirming(null);
      void list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" description={fallback ? "Confirm a payment here until the ERP link is live." : "The ERP confirms payments automatically."} />
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm sm:w-fit">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={cn("pressable rounded-lg px-4 py-1.5 font-medium", tab === t.key ? "bg-white shadow-sm" : "text-slate-500")}>{t.label}</button>
        ))}
      </div>

      {list.loading && !list.data && <div className="flex justify-center py-12"><Spinner /></div>}
      {list.error && !list.data && <StateView kind="error" message={list.error} onRetry={() => void list.reload()} />}
      {list.data && items.length === 0 && <StateView kind="empty" title={tab === "waiting" ? "Nothing is waiting" : "No payments here"} message={tab === "waiting" ? "When an executive requests a payment it shows up here." : "Nothing to show yet."} />}

      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((p) => (
          <Card key={p.id} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-900">{p.companyName}</div>
                <div className="truncate text-sm text-slate-500">{p.contactName}</div>
              </div>
              <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[p.status])}>{LABEL[p.status]}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-xs text-slate-400">Invoice</div><div className="font-medium">{p.invoiceNumber}</div></div>
              <div><div className="text-xs text-slate-400">Amount</div><div className="font-medium">{inr(p.amount)}</div></div>
              <div><div className="text-xs text-slate-400">Received</div><div className="font-medium">{p.amountPaid ? inr(p.amountPaid) : "—"}</div></div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-400">
              <span>Requested by {p.requestedByName ?? "—"} · {formatDate(p.requestedAt)}</span>
              {p.status === "confirmed" ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {p.confirmedAt ? formatDate(p.confirmedAt) : "Done"}
                  {p.source && <span className={cn("ml-1 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase", p.source === "erp" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")} title={p.source === "erp" ? "Confirmed automatically by the ERP" : "Confirmed by Finance"}>{p.source === "erp" ? "ERP synced" : "Manual"}</span>}
                </span>
              ) : fallback ? (
                <Button className="min-h-9 px-3 py-1.5 text-xs" onClick={() => setConfirming(p)}><BadgeCheck className="h-3.5 w-3.5" /> Confirm payment</Button>
              ) : (
                <span>Waiting for the ERP</span>
              )}
            </div>
            {role === "admin" && <Link href={`/leads/${p.leadId}`} className="block text-xs font-medium text-brand hover:underline">Open lead</Link>}
          </Card>
        ))}
      </div>

      <Sheet open={!!confirming} title="Confirm payment" subtitle={confirming ? `${confirming.companyName} · ${confirming.invoiceNumber}` : undefined} icon={Wallet} tone="emerald" onClose={() => setConfirming(null)}>
        {confirming && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">Record what has arrived for this invoice ({inr(confirming.amount)}). When the full amount is in, the deal turns to Won.</p>
            <InputField label="Amount received (₹)" type="number" required value={amount} onChange={(e) => { setAmount(e.target.value); setError(undefined); }} error={error} />
            <Button className="w-full" loading={busy} onClick={confirm}>Confirm payment</Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
