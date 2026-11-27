"use client";
import { Building2, Eye, Gift, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { RequestWizard } from "@/components/gifting/request-wizard";
import { ClientSetup } from "@/components/os/client-setup";
import { useClientFirst } from "@/components/os/client-first";
import { budgetLabel, codeOf, day, roleShort, STATUS_META, STATUS_ORDER, StatusChip } from "@/components/gifting/shared";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterMenu } from "@/components/ui/filter-menu";
import { PageHeader } from "@/components/ui/page-header";
import { PAGE_SIZE, Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { pickedClient } from "@/lib/selected-client";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { GiftRequestList } from "@/types/gifting";

/** Gift requests of the clients you look after, laid out like Gifting OS's list. */
export default function GiftingRequestsPage() {
  return <Suspense><GiftRequests /></Suspense>; // useSearchParams needs a boundary
}

/** "Today, 11:30 AM" for today, otherwise "10 Mar 2026". */
const createdLabel = (value: string) => {
  const when = new Date(value);
  return when.toDateString() === new Date().toDateString() ? `Today, ${when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : day(value);
};

function GiftRequests() {
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const router = useRouter();
  const allowed = role === "admin" || role === "sales_manager" || role === "kam";
  const canCreate = role === "admin" || role === "sales_manager"; // a KAM handles requests but does not raise them

  const [search, setSearch] = useState("");
  const q = useDebounce(search, 300);
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const list = useApi<GiftRequestList>(allowed ? "/gifting-requests" : null, { companyId: companyId || undefined, status: status || undefined, search: q || undefined, page, limit: pageSize });

  useEffect(() => { if (role && !allowed) router.replace("/dashboard"); }, [role, allowed, router]);
  useEffect(() => { setPage(1); }, [q, companyId, status]);
  // A bell alert or Home links here with ?open=<id>.
  const ask = useClientFirst({ active: creating && canCreate, fixed: companyId || pickedClient()?.id, onCancel: () => setCreating(false) });
  const opened = useSearchParams().get("open");
  useEffect(() => { if (opened) router.replace(`/gifting-requests/${opened}`); }, [opened, router]);
  if (!allowed) return null;

  const data = list.data;
  const countOf = (s: string) => data?.counts.find((c) => c.status === s)?.count ?? 0;
  const allCount = data?.counts.reduce((n, c) => n + c.count, 0) ?? 0;
  const filtered = !!(status || companyId || q);
  const picked = pickedClient();
  // The client chosen in the header is not in Gifting OS: no request can be made for it until it is set up.
  const unlinked = !!picked && !!data && !data.accounts.some((a) => a.id === picked.id);
  const reset = () => { setStatus(""); setCompanyId(""); setSearch(""); };

  return (
    <div className="space-y-4">
      <PageHeader title="Gift Requests" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter by status" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
          {["", ...STATUS_ORDER].map((s) => (
            <button key={s || "all"} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
              className={cn("pressable flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium", status === s ? "border-brand bg-brand text-white" : "border-slate-300/80 bg-white text-slate-600 hover:border-slate-400")}>
              {s ? STATUS_META[s as keyof typeof STATUS_META].label : "All"}
              <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", status === s ? "bg-white/20" : "bg-slate-100")}>{s ? countOf(s) : allCount}</span>
            </button>
          ))}
        </div>
        {canCreate && !unlinked && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New request</Button>}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200/70 px-4 py-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by recipient, occasion or request ID" className="min-w-0 flex-1 sm:max-w-md" />
          {(data?.accounts.length ?? 0) > 1 && (
            <FilterMenu icon={<Building2 className="h-4 w-4" />} label="Any client" searchable width={300} value={companyId} onChange={setCompanyId}
              options={[{ value: "", label: "Any client" }, ...(data?.accounts ?? []).map((a) => ({ value: a.id, label: a.name }))]} />
          )}
          <Button variant="ghost" onClick={reset} disabled={!filtered && !search}>Reset</Button>
        </div>

        {list.error && !data ? <StateView kind="error" message={list.error} onRetry={() => void list.reload()} />
          : !data || list.loading ? <TableSkeleton columns={7} rows={8} bare /> // also while a new tab, search or page loads
            : unlinked ? <ClientSetup key={picked!.id} companyId={picked!.id} name={picked!.name} onDone={() => void list.reload()} />
            : !data.items.length ? (
              <StateView kind="empty" title={filtered ? "No requests match" : "No gift requests yet"} message={!data.accounts.length ? "None of your client accounts is linked to Gifting OS yet." : filtered ? "Try a different status, client or search." : "Requests your clients submit in Gifting OS appear here."} />
            ) : (
              <Table className="min-w-[62rem]">
                <TableHeader className="bg-slate-50/80">
                  <TableRow>
                    <TableHead className="pl-4">Request</TableHead><TableHead>Recipient</TableHead><TableHead>Occasion</TableHead><TableHead>Requested by</TableHead>
                    <TableHead>Budget</TableHead><TableHead>Status</TableHead><TableHead className="pr-4 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((r) => {
                    const occasion = r.occasionName ?? r.eventName;
                    const when = r.occasionDate ?? r.eventDate ?? r.deliveryDate;
                    return (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/gifting-requests/${r.id}`)}>
                        <TableCell className="pl-4"><div className="font-semibold text-slate-900">{codeOf(r)}</div><div className="text-xs text-slate-500">{createdLabel(r.createdAt)}</div></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3"><Avatar name={r.recipientName} src={r.recipientAvatarUrl} size="sm" /><div className="min-w-0"><div className="max-w-[11rem] truncate font-semibold text-slate-900">{r.recipientName ?? "—"}</div><div className="max-w-[11rem] truncate text-xs text-slate-500">{[r.relationship, r.accountName].filter(Boolean).join(" · ")}</div></div></div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"><Gift className="h-4 w-4" /></span><div className="min-w-0"><div className="max-w-[11rem] truncate font-medium text-slate-900">{occasion ?? "—"}</div><div className="text-xs text-slate-500">{when ? day(when) : ""}</div></div></div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3"><Avatar name={r.createdByName} src={r.createdByAvatarUrl} size="sm" /><div className="min-w-0"><div className="max-w-[10rem] truncate font-medium text-slate-900">{r.createdByName ?? "—"}</div><div className="text-xs text-slate-500">{roleShort(r.createdByRole)}</div></div></div>
                        </TableCell>
                        <TableCell className="font-semibold tabular-nums text-slate-900">{budgetLabel(r)}</TableCell>
                        <TableCell><StatusChip status={r.status} /></TableCell>
                        <TableCell className="pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/gifting-requests/${r.id}`} className="pressable inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300/80 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Eye className="h-4 w-4" />View</Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
      </Card>
      {data && data.total > 0 && <Pagination page={page} pageSize={pageSize} total={data.total} noun={["request", "requests"]} loading={list.loading} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
      {ask.dialog}
      {creating && canCreate && ask.ready && <RequestWizard start={{ companyId: ask.clientId }} onClose={() => { setCreating(false); void list.reload(); }} onCreated={(id) => { setCreating(false); router.push(`/gifting-requests/${id}`); }} />}
    </div>
  );
}
