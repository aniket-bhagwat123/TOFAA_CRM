"use client";
import { Building2, ListFilter, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { budgetText, dayText, GIFT_STATUSES, statusOf } from "@/components/gifting/labels";
import { NewRequestSheet } from "@/components/gifting/new-request-sheet";
import { RequestSheet } from "@/components/gifting/request-sheet";
import { Button } from "@/components/ui/button";
import { FilterMenu } from "@/components/ui/filter-menu";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { GiftRequestList } from "@/types/gifting";

/** Gift requests (KAM and admin): everything the KAM's clients have sent to TOFAA, in one list. */
export default function GiftingRequestsPage() {
  return <Suspense><GiftRequests /></Suspense>; // useSearchParams needs a boundary
}

function GiftRequests() {
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const router = useRouter();
  const allowed = role === "admin" || role === "kam";

  const [search, setSearch] = useState("");
  const q = useDebounce(search, 300);
  const [companyId, setCompanyId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [viewing, setViewing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useApi<GiftRequestList>(allowed ? "/gifting-requests" : null, { companyId: companyId || undefined, status: status || undefined, search: q || undefined, page, limit: pageSize });

  useEffect(() => { if (role && !allowed) router.replace("/dashboard"); }, [role, allowed, router]);
  useEffect(() => { setPage(1); }, [q, companyId, status]);
  // A bell alert links here with ?open=<id>.
  const opened = useSearchParams().get("open");
  useEffect(() => { if (opened) setViewing(opened); }, [opened]);
  if (!allowed) return null;

  const data = list.data;
  const countOf = (s: string) => data?.counts.find((c) => c.status === s)?.count ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterMenu icon={<ListFilter className="h-4 w-4" />} label="Status" value={status} onChange={setStatus}
          options={[{ value: "", label: "All statuses" }, ...GIFT_STATUSES.map((s) => ({ value: s.value, label: s.label, hint: `${countOf(s.value)} request${countOf(s.value) === 1 ? "" : "s"}` }))]} />
        {(data?.accounts.length ?? 0) > 1 && (
          <FilterMenu icon={<Building2 className="h-4 w-4" />} label="Tenant" searchable width={300} value={companyId} onChange={setCompanyId}
            options={[{ value: "", label: "Tenant" }, ...(data?.accounts ?? []).map((a) => ({ value: a.id, label: a.name }))]} />
        )}
        <SearchInput value={search} onChange={setSearch} placeholder="Search title, number or recipient" className="min-w-0 flex-1 sm:w-auto sm:max-w-[20rem]" />
        {(status || companyId || search) && (
          <button type="button" onClick={() => { setStatus(""); setCompanyId(""); setSearch(""); }} className="pressable h-10 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-brand-soft">Clear all</button>
        )}
        <Button className="ml-auto" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New request</Button>
      </div>

      {list.error ? <StateView kind="error" message={list.error} onRetry={() => void list.reload()} />
        : !data ? <div className="flex justify-center py-12"><Spinner /></div>
          : !data.items.length ? (
            <StateView kind="empty" title="No gift requests" message={!data.accounts.length ? "None of your client accounts is linked to Gifting OS yet." : status || companyId || q ? "Nothing matches these filters." : "Requests your clients submit in Gifting OS appear here."} />
          ) : (
            <>
              <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-card">
                <table className="w-full min-w-[48rem] text-sm">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3">Request</th><th className="px-4 py-3">Account</th><th className="px-4 py-3">Recipient</th><th className="px-4 py-3">Deliver by</th><th className="px-4 py-3">Budget</th><th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((r) => (
                      <tr key={r.id} onClick={() => setViewing(r.id)} className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
                        <td className="px-4 py-2.5">
                          <button type="button" className="block text-left font-semibold text-slate-900 hover:text-brand">{r.title}</button>
                          <span className="text-xs text-slate-500">{r.requestCode}</span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{r.accountName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-slate-600">{r.recipientName ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-600">{dayText(r.deliveryDate)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-600">{budgetText(r)}</td>
                        <td className="px-4 py-2.5"><span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", statusOf(r.status).tone)}>{statusOf(r.status).label}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={pageSize} total={data.total} noun={["request", "requests"]} loading={list.loading}
                onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
            </>
          )}
      <NewRequestSheet open={creating} onClose={() => setCreating(false)} onCreated={(id) => { void list.reload(); setViewing(id); }} />
      <RequestSheet requestId={viewing} onClose={() => { setViewing(null); if (opened) router.replace("/gifting-requests"); }} onChanged={() => void list.reload()} />
    </div>
  );
}
