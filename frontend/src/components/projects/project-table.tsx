"use client";
import { MessageCircle, Pencil, Phone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { leadTarget } from "@/components/crm/lead-card";
import { iconButton, RowMenu, StageCell, type Actions } from "@/components/crm/lead-table";
import { Avatar } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { followUpLabel } from "@/lib/format";
import { inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";

const ORIGIN: Record<string, string> = { outbound: "We pitched", inbound: "Client asked", occasion: "Occasion", repeat: "Repeat", converted: "Converted" };

type Props = { projects: Lead[]; showOwner: boolean; canReassign: boolean; actions: Actions; onEdit: (p: Lead) => void };

/** Client projects as rows: what, for whom, where it stands, what it is worth, and what is next. */
export function ProjectTable({ projects, showOwner, canReassign, actions, onEdit }: Props) {
  const router = useRouter();
  const stop = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <Table>
        <TableHeader className="bg-slate-50/80">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Project</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Occasion</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead>Next follow-up</TableHead>
            {showOwner && <TableHead>Owner</TableHead>}
            <TableHead className="w-px pr-4">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((p) => {
            const t = leadTarget(p);
            const closed = p.stage === "closed_won" || p.stage === "closed_lost";
            const fu = followUpLabel(p.nextFollowUp);
            return (
              <TableRow key={p.id} onClick={() => router.push(`/projects/${p.id}`)} className="cursor-pointer">
                <TableCell className="pl-4">
                  <div className="flex max-w-[20rem] items-center gap-3">
                    <Avatar src={p.contact.photoUrl} name={p.company.name} size="sm" square />
                    <div className="min-w-0">
                      <div className="t-body truncate font-semibold text-slate-900">{p.projectTitle || "Untitled project"}</div>
                      <Link href={`/clients/${p.companyId}`} onClick={(e) => e.stopPropagation()} className="t-meta block truncate hover:text-brand hover:underline">{p.company.name}</Link>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-[12rem]">
                    <div className="t-body truncate text-slate-800">{p.contact.name}</div>
                    <div className="t-meta truncate">{p.contact.designation || p.contact.phone || "—"}</div>
                  </div>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}><StageCell lead={p} target={t} closed={closed} actions={actions} /></TableCell>
                <TableCell>
                  <div className="max-w-[10rem]">
                    <div className="t-body truncate text-slate-700">{p.occasion || "—"}</div>
                    {p.origin && <div className="t-meta truncate">{ORIGIN[p.origin] ?? p.origin}</div>}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {p.dealValue ? (
                    <div>
                      <div className="t-body font-semibold tabular-nums text-slate-900">{inrShort(p.dealValue)}</div>
                      {p.valueSource && <div className="t-meta capitalize">{p.valueSource}</div>}
                    </div>
                  ) : <span className="t-meta">—</span>}
                </TableCell>
                <TableCell>
                  <span className={cn("t-body font-medium", closed ? "text-slate-400" : fu.tone === "text-slate-500" ? "text-slate-700" : fu.tone)}>
                    {closed ? (p.stage === "closed_won" ? "Won" : "Lost") : fu.text}
                  </span>
                </TableCell>
                {showOwner && <TableCell><span className="t-body block max-w-[9rem] truncate text-slate-700">{p.owner?.fullName ?? "—"}</span></TableCell>}
                <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                  <div className="-ml-2 flex items-center gap-0.5">
                    <Tooltip label={!p.contact.phone ? "No phone number" : closed ? "Project is closed" : "Call"}>
                      <button type="button" aria-label={`Call ${p.contact.name}`} disabled={!p.contact.phone || closed} onClick={stop(() => actions.call(t))} className={iconButton}><Phone className="h-4 w-4" /></button>
                    </Tooltip>
                    <Tooltip label={p.contact.phone ? "Send WhatsApp" : "No phone number"}>
                      <button type="button" aria-label={`WhatsApp ${p.contact.name}`} disabled={!p.contact.phone} onClick={stop(() => actions.whatsapp(t))} className={iconButton}><MessageCircle className="h-4 w-4" /></button>
                    </Tooltip>
                    <Tooltip label="Edit">
                      <button type="button" aria-label={`Edit ${p.projectTitle ?? p.company.name}`} onClick={stop(() => onEdit(p))} className={iconButton}><Pencil className="h-4 w-4" /></button>
                    </Tooltip>
                    <RowMenu lead={p} target={t} closed={closed} canReassign={canReassign} actions={actions} />
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
