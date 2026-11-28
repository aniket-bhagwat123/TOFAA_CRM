"use client";
import { Check, FileSignature, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApprovalsCard } from "@/components/crm/approvals-card";
import { HandoverApprovals, type PendingHandover } from "@/components/orders/handover-approvals";
import { VoiceTextarea } from "@/components/crm/voice-textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet } from "@/components/ui/sheet";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { formatDate } from "@/lib/format";
import { inr } from "@/lib/money";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { Approval } from "@/types/crm";
import { usePaged } from "@/components/ui/use-paged";

type TermsItem = {
  leadId: string; companyName?: string; contactName?: string; ownerName?: string; total?: number | null; preparedAt?: string | null;
  terms: { title: string; body: string; custom: boolean }[];
};

/** Everything waiting for a manager: agreements with non-standard contract terms, and (older) discount requests. */
export default function ApprovalsPage() {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const router = useRouter();
  const allowed = !!user && isManager(user.role);
  const terms = useApi<TermsItem[]>(allowed ? "/approvals/agreements" : null);
  const discounts = useApi<Approval[]>(allowed ? "/approvals" : null);
  const handovers = useApi<PendingHandover[]>(allowed ? "/approvals/handovers" : null);
  const [rejecting, setRejecting] = useState<TermsItem | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (user && !allowed) router.replace("/dashboard"); }, [user, allowed, router]);
  const pagedTerms = usePaged(terms.data ?? [], ["agreement", "agreements"]);
  const pagedDiscounts = usePaged(discounts.data ?? [], ["quotation", "quotations"]);
  if (!allowed) return null;

  async function decide(item: TermsItem, approve: boolean, why?: string) {
    setBusy(item.leadId);
    try {
      await apiClient.post(`/leads/${item.leadId}/agreement/terms-decision`, { approve, note: why?.trim() || null });
      toast.success(approve ? "Approved. The KAM can download the agreement now." : "Rejected. The KAM has been told.");
      setRejecting(null); setNote("");
      void terms.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const loading = (terms.loading && !terms.data) || (discounts.loading && !discounts.data);
  const empty = terms.data?.length === 0 && (discounts.data?.length ?? 0) === 0 && (handovers.data?.length ?? 0) === 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Approvals" description="Deal handovers and agreements with non-standard contract terms wait here for a manager." />
      {loading && <TableSkeleton columns={4} rows={5} />}
      {terms.error && !terms.data && <StateView kind="error" message={terms.error} onRetry={() => void terms.reload()} />}
      {empty && <StateView kind="empty" title="Nothing to approve" message="Deal handovers sent for approval and changed contract terms show up here." />}

      {!!handovers.data?.length && <HandoverApprovals items={handovers.data} />}

      {!!terms.data?.length && (
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <FileSignature className="h-4 w-4 text-amber-500" /> Agreement terms waiting for approval
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{terms.data.length}</span>
          </h2>
          {pagedTerms.rows.map((item) => (
            <div key={item.leadId} className="space-y-3 rounded-xl border border-amber-200/70 bg-amber-50/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/leads/${item.leadId}`} className="font-medium text-slate-900 hover:text-brand">{item.companyName}</Link>
                  <div className="text-xs text-slate-500">
                    {item.contactName} · {item.ownerName ?? "—"}{item.total ? ` · ${inr(item.total)}` : ""}{item.preparedAt ? ` · ${formatDate(item.preparedAt)}` : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" disabled={busy === item.leadId} onClick={() => { setRejecting(item); setNote(""); }}><X className="h-3.5 w-3.5" /> Reject</Button>
                  <Button className="min-h-9 px-3 py-1.5 text-xs" loading={busy === item.leadId} onClick={() => decide(item, true)}><Check className="h-3.5 w-3.5" /> Approve</Button>
                </div>
              </div>
              <ol className="space-y-1.5">
                {item.terms.map((t, i) => (
                  <li key={i} className={cn("rounded-lg border px-3 py-2 text-xs", t.custom ? "border-amber-300 bg-white" : "border-transparent bg-white/60 text-slate-500")}>
                    <span className="font-semibold text-slate-800">{String(i + 1).padStart(2, "0")}. {t.title}</span>
                    {t.custom && <span className="ml-2 rounded bg-amber-100 px-1.5 py-px text-[11px] font-semibold uppercase text-amber-800">Changed / new</span>}
                    <p className="mt-0.5 text-slate-600">{t.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </Card>
      )}

      {pagedTerms.footer}

      {discounts.data && <ApprovalsCard items={pagedDiscounts.rows} total={discounts.data.length} onChanged={() => void discounts.reload()} />}
      {pagedDiscounts.footer}

      <Sheet open={!!rejecting} title="Reject these terms" subtitle={rejecting?.companyName} icon={X} tone="red" onClose={() => setRejecting(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-500">The KAM sees your reason, changes the terms and saves again.</p>
          <VoiceTextarea label="Reason (optional)" value={note} onChange={setNote} rows={3} placeholder="Write the reason" />
          <Button variant="danger" className="w-full" loading={busy === rejecting?.leadId} onClick={() => rejecting && decide(rejecting, false, note)}>Reject</Button>
        </div>
      </Sheet>
    </div>
  );
}
