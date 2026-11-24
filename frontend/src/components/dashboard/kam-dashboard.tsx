"use client";
import { Building2, CalendarClock, CalendarHeart, FolderKanban, IndianRupee, PackageCheck, Trophy } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { inr, inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Bars, Empty, Section, Tile } from "./widgets";

export type KamData = {
  accounts: { count: number; lifetime: number; revenue12m: number; openProjects: number };
  occasions: { id: string; name: string; occasion: string; date: string; daysAway: number }[];
  topAccounts: { id: string; name: string; tier?: string; lifetime?: number; openProjects?: number }[];
  orders: Record<"new" | "production" | "quality_check" | "dispatched" | "delivered", number> | null;
  followUps: { overdue: number; today: number };
};

const ORDER_LABEL: [keyof NonNullable<KamData["orders"]>, string][] = [
  ["new", "Not started"], ["production", "Production"], ["quality_check", "Quality check"], ["dispatched", "Dispatched"], ["delivered", "Delivered"],
];

/** A KAM's accounts: revenue, open projects, occasions coming up, their accounts' orders, and their follow-ups. */
export function KamDashboard({ d }: { d: KamData }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="My accounts" value={String(d.accounts.count)} hint={`${d.accounts.openProjects} open ${d.accounts.openProjects === 1 ? "project" : "projects"}`} icon={Building2} href="/clients" />
        <Tile label="Revenue, last 12 months" value={inrShort(d.accounts.revenue12m)} hint={`Lifetime ${inrShort(d.accounts.lifetime)}`} icon={IndianRupee} />
        <Tile label="Overdue follow-ups" value={String(d.followUps.overdue)} hint="Call these first" icon={CalendarClock} tone={d.followUps.overdue ? "text-red-600" : ""} href="/follow-ups" />
        <Tile label="Due today" value={String(d.followUps.today)} hint="Client check-ins" icon={CalendarClock} href="/follow-ups" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Occasions in the next 30 days" icon={CalendarHeart} href="/clients" linkLabel="My Accounts">
          {d.occasions.length === 0 ? <Empty>No occasions coming up. Add them on each account.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {d.occasions.map((o) => (
                <li key={o.id + o.occasion}>
                  <Link href={`/clients/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-brand">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{o.name}</span>
                      <span className="block truncate text-xs text-slate-500">{o.occasion} · {formatDate(o.date)}</span>
                    </span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", o.daysAway <= 7 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700")}>
                      {o.daysAway === 0 ? "Today" : `in ${o.daysAway} ${o.daysAway === 1 ? "day" : "days"}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Orders of my accounts" icon={PackageCheck} href="/orders" linkLabel="Orders">
          {!d.orders ? <Empty>Orders are not set up yet.</Empty> : (
            <Bars format={(n) => String(n)} empty="No orders yet." rows={ORDER_LABEL.map(([k, label]) => ({ key: k, label, value: d.orders![k] ?? 0 }))} />
          )}
        </Section>

        <Section title="Top accounts" icon={Trophy} href="/clients" linkLabel="My Accounts" className="lg:col-span-2">
          {d.topAccounts.length === 0 ? <Empty>No accounts yet. Add one from My Accounts.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {d.topAccounts.map((a) => (
                <li key={a.id}>
                  <Link href={`/clients/${a.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-brand">
                    <span className="flex min-w-0 items-center gap-2">
                      {a.tier && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">Tier {a.tier}</span>}
                      <span className="truncate font-medium text-slate-900">{a.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                      {!!a.openProjects && <span className="inline-flex items-center gap-1"><FolderKanban className="h-3.5 w-3.5" />{a.openProjects} open</span>}
                      <span className="font-semibold tabular-nums text-slate-800">{inr(a.lifetime ?? 0)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
