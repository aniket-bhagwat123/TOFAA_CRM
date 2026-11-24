"use client";
import { Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { QUOTE_STATUS } from "@/components/lead/deal-cards";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { openPdf } from "@/features/media/download";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { formatDate } from "@/lib/format";
import { inr } from "@/lib/money";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { Paged } from "@/types/api";
import type { AssignableUser, QuotationStatus } from "@/types/crm";

type Row = {
  id: string; leadId: string; number: string; version: number; status: QuotationStatus; total: number; discountPct?: number;
  createdAt: string; sentAt?: string | null; sentVia?: string | null; author?: { fullName?: string | null } | null;
  lead: { id: string; pipeline?: string; company?: { name: string }; contact?: { name: string }; owner?: { fullName?: string | null } | null };
};
const FILTERS: [string, string][] = [["", "All"], ["ready", "Ready to send"], ["approved", "Approved"], ["sent", "Sent"], ["pending_approval", "Waiting for approval"], ["rejected", "Rejected"]];
const SELECT = "h-10 w-full shrink-0 truncate rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 sm:w-44";

/** Every quotation in one list, with its version, status and total. Opens the lead to edit or send. */
export default function QuotationsPage() {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const manager = !!user && isManager(user.role);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounce(search, 300);
  const list = useApi<Paged<Row>>("/quotations", { search: q || undefined, status: status || undefined, ownerId: owner || undefined, page, limit: 25 });
  const people = useApi<AssignableUser[]>(manager ? "/users/assignable" : null);
  const reset = (fn: () => void) => { fn(); setPage(1); };
  const leadHref = (r: Row) => (r.lead.pipeline === "client" ? `/projects/${r.leadId}` : `/leads/${r.leadId}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="sm:w-64" value={search} onChange={(v) => reset(() => setSearch(v))} placeholder="Search company or contact" />
        {manager && (
          <select className={SELECT} value={owner} onChange={(e) => reset(() => setOwner(e.target.value))} aria-label="Owner">
            <option value="">Whole team</option>
            {people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={status === value} onClick={() => reset(() => setStatus(value))}
            className={cn("pressable h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium", status === value ? "border-brand bg-brand text-white" : "border-slate-300/80 bg-white text-slate-600 hover:border-slate-400")}>
            {label}
          </button>
        ))}
      </div>

      {list.loading && !list.data && <div className="flex justify-center py-12"><Spinner /></div>}
      {list.error && !list.data && <StateView kind="error" message={list.error} onRetry={() => void list.reload()} />}
      {list.data && list.data.items.length === 0 && <StateView kind="empty" title="No quotations" message={q || status || owner ? "Try a different search or filter." : "Quotations made on leads show up here."} />}
      {list.data && list.data.items.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
          <Table>
            <TableHeader className="bg-slate-50/80">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Quotation</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-px pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <div className="font-semibold text-slate-900">{r.number}</div>
                    <div className="text-xs text-slate-500">v{r.version} · {formatDate(r.createdAt)}</div>
                  </TableCell>
                  <TableCell>
                    <Link href={leadHref(r)} className="font-medium text-slate-800 hover:text-brand">{r.lead.company?.name}</Link>
                    <div className="text-xs text-slate-500">{r.lead.contact?.name}</div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{r.lead.owner?.fullName ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{inr(r.total)}</TableCell>
                  <TableCell>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", QUOTE_STATUS[r.status]?.tone)}>
                      {r.status === "sent" && r.sentVia ? `Sent by ${r.sentVia}` : QUOTE_STATUS[r.status]?.label ?? r.status}
                    </span>
                    {r.sentAt && <div className="mt-0.5 text-xs text-slate-400">{formatDate(r.sentAt)}</div>}
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" className="min-h-8 px-2.5 py-1 text-xs" onClick={() => void openPdf(`/quotations/${r.id}/pdf`)}><Download className="h-3.5 w-3.5" /> PDF</Button>
                      <Link href={leadHref(r)} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100"><ExternalLink className="h-3.5 w-3.5" /> Open</Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {list.data && list.data.meta.pages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {list.data.meta.pages} · {list.data.meta.total} quotations</span>
          <Button variant="secondary" disabled={page >= list.data.meta.pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
