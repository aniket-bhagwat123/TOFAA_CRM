"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ALL_CLIENTS, ClientGate } from "@/components/os/client-gate";
import { useClientFirst } from "@/components/os/client-first";
import { DaySheet, NEW_DAY, type DayDraft } from "@/components/os/day-sheet";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PAGE_SIZE, Pagination } from "@/components/ui/pagination";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDelete } from "@/components/ui/use-delete";
import { useApi } from "@/hooks/use-api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Events } from "@/types/os-modules";

/** The client's events: a day that matters for one person. */
export default function EventsPage() {
  return (
    <>
      <PageHeader title="Events" />
      <ClientGate>{(companyId) => <EventList companyId={companyId} />}</ClientGate>
    </>
  );
}

function EventList({ companyId }: { companyId: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState<DayDraft | null>(null);
  const list = useApi<Events>(`/os/${companyId}/events`, { page, limit: pageSize });
  const reload = () => void list.reload();
  const remove = useDelete(reload);
  // A new event needs one client: ask first when all are shown.
  const ask = useClientFirst({ active: !!draft && !draft.id, fixed: companyId === ALL_CLIENTS ? null : companyId, onCancel: () => setDraft(null) });
  const canEdit = !!list.data?.actionsEnabled;
  const all = companyId === ALL_CLIENTS;
  const total = list.data?.pagination.total_records ?? list.data?.pagination.totalRecords ?? 0;

  return (
    <>
      {canEdit && <div className="flex justify-end"><Button onClick={() => setDraft({ ...NEW_DAY })}><Plus className="h-4 w-4" />Add event</Button></div>}
      {list.error && !list.data ? <StateView kind="error" message={list.error} onRetry={reload} />
        : !list.data ? <TableSkeleton columns={5} rows={8} />
          : !list.data.items.length ? <StateView kind="empty" title="No events" message="Events for this client's people show here." />
            : (
              <>
                <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
                  <Table className="min-w-[44rem]">
                    <TableHeader className="bg-slate-50/80"><TableRow><TableHead className="pl-4">Event</TableHead><TableHead>Person</TableHead>{all && <TableHead>Client</TableHead>}<TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="w-px pr-4">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {list.data.items.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="pl-4"><div className="font-semibold text-slate-900">{e.eventName}</div>{e.description && <div className="max-w-[20rem] truncate text-xs text-slate-500">{e.description}</div>}</TableCell>
                          <TableCell className="text-slate-700">{e.recipientName ?? "—"}</TableCell>
                          {all && <TableCell className="text-slate-600">{e.accountName}</TableCell>}
                          <TableCell className="text-slate-700">{formatDate(e.eventDate)} {e.eventDate.slice(0, 4)}{e.repeatAnnually ? " · yearly" : ""}</TableCell>
                          <TableCell><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", e.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>{e.isActive ? "Active" : "Inactive"}</span></TableCell>
                          <TableCell className="pr-4">
                            {canEdit ? (
                              <div className="flex gap-1">
                                <button type="button" aria-label={`Edit ${e.eventName}`} className="pressable rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={() => setDraft({ id: e.id, companyId: e.accountId, name: e.eventName, day: e.eventDate, description: e.description ?? "", repeatAnnually: e.repeatAnnually })}><Pencil className="h-4 w-4" /></button>
                                <button type="button" aria-label={`Delete ${e.eventName}`} className="pressable rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600" onClick={() => remove.ask({ path: `/os/${e.accountId ?? companyId}/events/${e.id}`, title: `Delete ${e.eventName}?`, done: "Event deleted", message: "It is removed from Gifting OS too." })}><Trash2 className="h-4 w-4" /></button>
                              </div>
                            ) : <span className="text-xs text-slate-400">View only</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Pagination page={page} pageSize={pageSize} total={total} noun={["event", "events"]} loading={list.loading} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
              </>
            )}
      {ask.dialog}
      <DaySheet companyId={draft && !draft.id ? ask.clientId ?? companyId : companyId} kind="event" draft={draft && (draft.id || ask.ready) ? draft : null} onClose={() => setDraft(null)} onSaved={reload} />
      {remove.dialog}
    </>
  );
}
