"use client";
import { AlertTriangle, CalendarClock, CalendarHeart, FolderKanban } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { formatDate, formatTime } from "@/lib/format";
import { inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ClientSummary } from "@/types/crm";
import { ContactButtons } from "../crm/contact-buttons";
import { AssignButton } from "./assign-button";

export const TIER_TONE = { A: "bg-amber-100 text-amber-800 ring-amber-200", B: "bg-slate-100 text-slate-700 ring-slate-200", C: "bg-white text-slate-500 ring-slate-200" };

type Props = { client: ClientSummary; showOwner?: boolean; onCall: () => void; onWhatsApp: () => void; onAssign?: () => void };

/** A client at a glance: worth, last order, what is open, and the next occasion to call about. */
export function ClientCard({ client, showOwner, onCall, onWhatsApp, onAssign }: Props) {
  const occ = client.nextOccasion;
  const soon = occ && occ.daysAway <= 45;
  const noOccasions = client.occasionCount === 0;
  const next = client.nextCheckIn;
  const nextAt = next ? Date.parse(next.dueAt ?? `${next.dueDate}T23:59:59+05:30`) : 0;
  const late = !!next && nextAt < Date.now();
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card transition-all hover:-translate-y-0.5 hover:shadow-float">
      <Link href={`/clients/${client.id}`} className="flex flex-1 flex-col gap-3.5 p-4">
        <div className="flex items-start gap-3">
          <Avatar src={client.logoUrl ?? client.primaryContact?.photoUrl} name={client.name} size="lg" square className={client.logoUrl ? "bg-white object-contain ring-1 ring-slate-200" : undefined} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-brand">{client.name}</h3>
              <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1", TIER_TONE[client.tier])}>{client.tier}</span>
            </div>
            <p className="truncate text-sm text-slate-500">{client.primaryContact?.name ?? "No contact"}{client.city ? ` · ${client.city}` : ""}</p>
            {client.giftingInactive && <span className="mr-1 mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-800">Inactive in Gifting OS</span>}
            {client.status === "dormant" && <span className="mt-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-[12px] font-medium text-red-600">Dormant</span>}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 py-2"><div className="text-sm font-semibold text-slate-900">{inrShort(client.lifetimeValue)}</div><div className="text-[11px] uppercase tracking-wide text-slate-400">Lifetime</div></div>
          <div className="rounded-xl bg-slate-50 py-2"><div className="text-sm font-semibold text-slate-900">{client.wonProjects}</div><div className="text-[11px] uppercase tracking-wide text-slate-400">Orders</div></div>
          <div className="rounded-xl bg-slate-50 py-2"><div className="text-sm font-semibold text-slate-900">{client.openProjects}</div><div className="text-[11px] uppercase tracking-wide text-slate-400">Open</div></div>
        </div>

        <div className="space-y-1.5 text-xs">
          {!noOccasions && (
            <div className={cn("flex items-center gap-2", soon ? "font-medium text-indigo-700" : "text-slate-600")}>
              <CalendarHeart className="h-3.5 w-3.5 shrink-0" />
              {occ ? `${occ.name} · ${formatDate(occ.date)} (${occ.daysAway === 0 ? "today" : `in ${occ.daysAway} days`})` : "Occasion date not in the calendar yet"}
            </div>
          )}
          <div className={cn("flex items-center gap-2", late ? "font-medium text-red-600" : "text-slate-600")} title={next?.title ?? undefined}>
            <CalendarClock className={cn("h-3.5 w-3.5 shrink-0", late ? "" : "text-slate-400")} />
            <span className="truncate">
              {next
                ? `${late ? "Overdue" : "Next"}: ${formatDate(next.dueAt ?? next.dueDate)}${next.dueAt ? `, ${formatTime(next.dueAt).toUpperCase()}` : ""}${next.title ? ` · ${next.title}` : ""}`
                : <span className="text-slate-400">No call planned</span>}
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-600"><FolderKanban className="h-3.5 w-3.5 shrink-0 text-slate-400" />{client.lastOrderAt ? `Last order ${formatDate(client.lastOrderAt)}` : "No order yet"}</div>
          {/* a small reminder at the bottom, not a banner: occasions are what drive the call reminders */}
          {noOccasions && (
            <div className="flex items-center gap-1.5 pt-0.5 text-xs font-medium text-amber-700" title="Add their gifting occasions to get call reminders before each one">
              <AlertTriangle className="h-3 w-3 shrink-0" />No occasions added
            </div>
          )}
        </div>
      </Link>
      <footer className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
        <span className="truncate text-xs text-slate-500">{showOwner ? `Account owner: ${client.owner?.fullName ?? "Unassigned"}` : client.clientSince ? `Client since ${formatDate(client.clientSince)}` : ""}</span>
        {onAssign && <AssignButton assigned={!!client.owner} name={client.name} onClick={onAssign} className="ml-auto" />}
        <ContactButtons onCall={onCall} onWhatsApp={onWhatsApp} disabled={!client.primaryContact?.phone} />
      </footer>
    </article>
  );
}
