"use client";
import { useState } from "react";
import { ActivityRows } from "@/components/os/activity-list";
import { ClientGate } from "@/components/os/client-gate";
import { PageHeader } from "@/components/ui/page-header";
import { PAGE_SIZE, Pagination } from "@/components/ui/pagination";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import type { ActivityList } from "@/types/os-modules";

/** What changed in the client's Gifting OS account, and who did it. (CRM's own Activity is a separate page.) */
export default function OsActivityPage() {
  return (
    <>
      <PageHeader title="Activity" />
      <ClientGate>{(companyId) => <Feed companyId={companyId} />}</ClientGate>
    </>
  );
}

function Feed({ companyId }: { companyId: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const list = useApi<ActivityList>(`/os/${companyId}/activity`, { page, limit: pageSize });
  if (list.error && !list.data) return <StateView kind="error" message={list.error} onRetry={() => void list.reload()} />;
  if (!list.data) return <TableSkeleton columns={3} rows={8} />;
  if (!list.data.items.length && page === 1) return <StateView kind="empty" title="Nothing yet" message="When something changes in this client's account, it shows up here." />;
  const total = list.data.pagination.total_records ?? list.data.pagination.totalRecords ?? 0;
  return (
    <>
      <ActivityRows items={list.data.items} />
      <Pagination page={page} pageSize={pageSize} total={total} noun={["change", "changes"]} loading={list.loading} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </>
  );
}
