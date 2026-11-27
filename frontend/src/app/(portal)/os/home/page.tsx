"use client";
import { CalendarRange, ClipboardList, Plus, Star, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ALL_CLIENTS, ClientGate } from "@/components/os/client-gate";
import { ActionRequiredCard, type ActivityRow, BannerStrip, ImportantPeopleCard, OccasionCalendar, RecentActivityCard } from "@/components/os/home-cards";
import { PageHeader } from "@/components/ui/page-header";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { Events, OsHome } from "@/types/os-modules";

type Requests = { total: number; items: { id: string; title: string; status: string; updatedAt: string }[] };

const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"; };
const actionClass = (primary: boolean) => cn("pressable inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-4 text-[12px] font-semibold",
  primary ? "border-brand bg-brand text-white hover:bg-brand-dark" : "border-brand/60 bg-white text-brand hover:bg-brand-soft/50");

/** The client's Home, laid out like the Gifting OS Home. */
export default function OsHomePage() {
  return (
    <>
      <PageHeader title="Home" />
      <ClientGate>{(companyId) => <Home companyId={companyId} />}</ClientGate>
    </>
  );
}

function Home({ companyId }: { companyId: string }) {
  const fullName = useAppSelector((s) => s.auth.session?.profile.fullName);
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [category, setCategory] = useState("ALL");
  const home = useApi<OsHome>(`/os/${companyId}/home`, { month, category });
  const requests = useApi<Requests>("/gifting-requests", { companyId: companyId === ALL_CLIENTS ? undefined : companyId, limit: 20 });
  const events = useApi<Events>(`/os/${companyId}/events`, { limit: 1 });
  const firstName = (fullName ?? "").trim().split(/\s+/)[0];
  if (home.error && !home.data) return <StateView kind="error" message={home.error} onRetry={() => void home.reload()} />;

  const data = home.data;
  const loading = home.loading && !data;
  const recent: ActivityRow[] = [
    ...(requests.data?.items ?? []).filter((r) => r.status !== "DRAFT").map((r): ActivityRow => ({
      key: `r-${r.id}`, title: `Gift ${r.status.toLowerCase().replace(/_/g, " ")} – ${r.title}`, at: r.updatedAt,
      kind: r.status === "DELIVERED" ? "done" : r.status === "DISPATCHED" ? "shipping" : "update",
    })),
    ...(data?.activity ?? []).map((a): ActivityRow => ({ key: `a-${a.id}`, title: `${a.accountName ? `${a.accountName}: ` : ""}${a.title || a.description}`, at: a.changedAt, kind: "update" })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 3);
  const stats: { label: string; Icon: LucideIcon; tint: string; href: string; count?: number }[] = [
    { label: "Gift requests", Icon: ClipboardList, tint: "bg-rose-500", href: "/gifting-requests", count: requests.data?.total },
    { label: "Events", Icon: CalendarRange, tint: "bg-amber-500", href: "/os/events", count: events.data?.pagination.total_records ?? events.data?.pagination.totalRecords },
  ];

  return (
    <div className="space-y-3">
      <BannerStrip companyId={companyId === ALL_CLIENTS ? undefined : companyId} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-slate-900 sm:text-[20px]">{greeting()}{firstName ? `, ${firstName}` : ""}! <span aria-hidden="true">👋</span></h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/gifting-requests" className={actionClass(true)}><Plus size={16} />Review Requests</Link>
          <Link href="/os/events" className={actionClass(false)}><Plus size={16} />View Events</Link>
        </div>
      </div>

      <section aria-label="Overview" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="pressable block rounded-[10px] border border-slate-200/70 bg-white p-4 shadow-card hover:shadow-float">
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg text-white", s.tint)}><s.Icon size={18} /></span>
            <p className="mt-3 text-[24px] font-semibold leading-[30px] tracking-tight text-slate-900">{s.count ?? "–"}</p>
            <p className="mt-0.5 text-[12px] text-slate-500">{s.label}</p>
          </Link>
        ))}
      </section>

      <OccasionCalendar items={data?.calendar.items ?? []} month={month} filter={category} loading={home.loading} failed={!!home.error} onMonth={setMonth} onFilter={setCategory} />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <ImportantPeopleCard title="Upcoming External People" icon={<Star size={18} className="fill-amber-400" />} people={data?.summary.importantExternal ?? []} loading={loading} empty="Add clients or partners to track key dates." />
        <ImportantPeopleCard title="Upcoming Internal People" icon={<Users size={18} className="text-brand" />} people={data?.summary.importantInternal ?? []} loading={loading} empty="Add employees to track their key dates." />
        <ActionRequiredCard items={data?.summary.actionRequired.items ?? []} total={data?.summary.actionRequired.total ?? 0} loading={loading} />
      </div>
      <RecentActivityCard rows={recent} loading={loading} />
    </div>
  );
}
