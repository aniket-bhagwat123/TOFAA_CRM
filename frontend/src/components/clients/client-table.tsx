"use client";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { ContactButtons } from "@/components/crm/contact-buttons";
import { Avatar } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatTime } from "@/lib/format";
import { inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ClientSummary } from "@/types/crm";
import { AssignButton } from "./assign-button";
import { TIER_TONE } from "./client-card";

type Props = { clients: ClientSummary[]; showOwner: boolean; onCall: (c: ClientSummary) => void; onWhatsApp: (c: ClientSummary) => void; onAssign?: (c: ClientSummary) => void };

/**
 * Clients as a table (the Table view of Clients / My Accounts): the same facts as the cards, one row each, so many
 * accounts can be scanned and compared. A row opens the client; Call logs the outcome like everywhere else.
 */
export function ClientTable({ clients, showOwner, onCall, onWhatsApp, onAssign }: Props) {
  const router = useRouter();
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <Table className="min-w-[60rem]">
        <TableHeader className="bg-slate-50/80">
          <TableRow>
            <TableHead className="pl-4">Client</TableHead>
            {showOwner && <TableHead>Account owner</TableHead>}
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Lifetime</TableHead>
            <TableHead className="text-right">Orders</TableHead>
            <TableHead className="text-right">Open</TableHead>
            <TableHead>Next call</TableHead>
            <TableHead>Next occasion</TableHead>
            <TableHead className="pr-4 text-right">Contact</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((c) => {
            const next = c.nextCheckIn;
            const late = !!next && Date.parse(next.dueAt ?? `${next.dueDate}T23:59:59+05:30`) < Date.now();
            const occ = c.nextOccasion;
            return (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/clients/${c.id}`)}>
                <TableCell className="py-3 pl-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar src={c.logoUrl ?? c.primaryContact?.photoUrl} name={c.name} size="sm" square className={c.logoUrl ? "bg-white object-contain ring-1 ring-slate-200" : undefined} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold text-slate-900">{c.name}</span>
                        <span className={cn("shrink-0 rounded px-1 py-px text-[11px] font-bold ring-1", TIER_TONE[c.tier])} title={`Tier ${c.tier}`}>{c.tier}</span>
                      </div>
                      <div className="truncate text-xs text-slate-500">{c.primaryContact?.name ?? "No contact"}{c.city ? ` · ${c.city}` : ""}</div>
                    </div>
                  </div>
                </TableCell>
                {showOwner && (
                  <TableCell className="whitespace-nowrap text-slate-600" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-3">
                      <span className="min-w-[7rem]">{c.owner?.fullName ?? "Unassigned"}</span>
                      {onAssign && <AssignButton assigned={!!c.owner} name={c.name} onClick={() => onAssign(c)} />}
                    </div>
                  </TableCell>
                )}
                <TableCell>
                  <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium", c.status === "dormant" ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700")}>
                    {c.status === "dormant" ? "Dormant" : "Active"}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium text-slate-800">{inrShort(c.lifetimeValue)}</TableCell>
                <TableCell className="text-right tabular-nums">{c.wonProjects}</TableCell>
                <TableCell className="text-right tabular-nums">{c.openProjects}</TableCell>
                <TableCell className={cn("whitespace-nowrap text-xs", late ? "font-medium text-red-600" : "text-slate-600")}>
                  {next ? `${late ? "Overdue · " : ""}${formatDate(next.dueAt ?? next.dueDate)}${next.dueAt ? `, ${formatTime(next.dueAt).toUpperCase()}` : ""}` : <span className="text-slate-400">None planned</span>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {c.occasionCount === 0 ? (
                    <span className="inline-flex items-center gap-1 font-medium text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Not added</span>
                  ) : occ ? (
                    <span className={occ.daysAway <= 45 ? "font-medium text-indigo-700" : "text-slate-600"}>{occ.name} · {occ.daysAway === 0 ? "today" : `in ${occ.daysAway} days`}</span>
                  ) : <span className="text-slate-400">Date not set</span>}
                </TableCell>
                <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end">
                    <ContactButtons onCall={() => onCall(c)} onWhatsApp={() => onWhatsApp(c)} disabled={!c.primaryContact?.phone} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
