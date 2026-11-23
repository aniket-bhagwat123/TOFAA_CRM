"use client";
import { Bell, CalendarPlus, Check, ChevronDown, ExternalLink, Flag, History, MapPin, MessageCircle, MoreHorizontal, Pencil, Phone, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type MouseEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Popover } from "@/components/ui/popover";
import { StageBadge } from "@/components/ui/stage-badge";
import { Tooltip } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PIPELINE_STAGES, STAGE_LABEL, STAGE_TONE } from "@/lib/format";
import { dealHref } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { Lead, StageKey } from "@/types/crm";
import { StageIcon } from "../lead/stage-icon";
import { CallStatusBadge, LeadTags } from "./call-status-badge";
import { leadTarget } from "./lead-card";
import type { LeadTarget } from "./types";

export type Actions = {
  call: (t: LeadTarget) => void;
  whatsapp: (t: LeadTarget) => void;
  meeting: (t: LeadTarget) => void;
  schedule: (t: LeadTarget) => void;
  close: (t: LeadTarget) => void;
  reassign: (t: LeadTarget) => void;
  moveTo: (t: LeadTarget, s: StageKey) => void;
};

type Props = { leads: Lead[]; canReassign: boolean; actions: Actions; onEdit: (lead: Lead) => void };

// Small, quiet icon buttons: grey until hovered, so the row reads as text first.
export const iconButton = "pressable inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-35";

/** Google Maps search for the company in its city. */
export const mapsHref = (l: Lead) =>
  l.company.city ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.company.name}, ${l.company.city}`)}` : null;

/** Leads as rows: who, how to reach them in one tap, where they are in the deal, and where they are on the map. */
export function LeadTable({ leads, canReassign, actions, onEdit }: Props) {
  const router = useRouter();
  const showCalls = leads.some((l) => l.pipeline !== "client"); // client projects do not run on calls
  const stop = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <Table>
        <TableHeader className="bg-slate-50/80">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Company</TableHead>
            <TableHead>Contact person</TableHead>
            <TableHead>Stage</TableHead>
            {showCalls && <TableHead>Call status</TableHead>}
            <TableHead>Location</TableHead>
            <TableHead className="w-px pr-4">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((l) => {
            const t = leadTarget(l);
            const closed = l.stage === "closed_won" || l.stage === "closed_lost";
            const maps = mapsHref(l);
            return (
              <TableRow key={l.id} onClick={() => router.push(dealHref(l))} className="cursor-pointer">
                <TableCell className="pl-4">
                  <div className="flex max-w-[18rem] items-center gap-3">
                    <Avatar src={l.contact.photoUrl} name={l.company.name} size="sm" square />
                    <div className="min-w-0">
                      <div className="t-body truncate font-semibold text-slate-900">{l.company.name}</div>
                      {l.pipeline === "client" && l.projectTitle && <div className="t-meta truncate">{l.projectTitle}</div>}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-[14rem]">
                    <div className="t-body truncate text-slate-800">{l.contact.name}</div>
                    <div className="t-meta truncate">{l.contact.designation || l.contact.phone || "—"}</div>
                  </div>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}><StageCell lead={l} target={t} closed={closed} actions={actions} /></TableCell>
                {showCalls && <TableCell><div className="flex max-w-[14rem] flex-wrap gap-1"><CallStatusBadge outcome={l.lastCallOutcome} at={l.lastCallAt} attempts={l.callAttempts} className="text-xs" />{!["closed_won", "closed_lost"].includes(l.stage) && <LeadTags tags={l.tags} outcome={l.lastCallOutcome} />}</div></TableCell>}
                <TableCell>
                  {maps ? (
                    <a href={maps} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open in Google Maps" className="pressable inline-flex max-w-[11rem] items-center gap-1.5 rounded-full bg-sky-50 py-1.5 pl-2.5 pr-3 text-xs font-medium text-sky-700 hover:bg-sky-100">
                      <MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{l.company.city}</span>
                    </a>
                  ) : (
                    <span className="t-meta">—</span>
                  )}
                </TableCell>
                <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                  <div className="-ml-2 flex items-center gap-0.5">
                    <Tooltip label={!l.contact.phone ? "No phone number" : closed ? "Lead is closed" : "Call"}>
                      <button type="button" aria-label={`Call ${l.contact.name}`} disabled={!l.contact.phone || closed} onClick={stop(() => actions.call(t))} className={iconButton}>
                        <Phone className="h-4 w-4" />
                      </button>
                    </Tooltip>
                    <Tooltip label={l.contact.phone ? "Send WhatsApp" : "No phone number"}>
                      <button type="button" aria-label={`WhatsApp ${l.contact.name}`} disabled={!l.contact.phone} onClick={stop(() => actions.whatsapp(t))} className={iconButton}>
                        <MessageCircle className="h-4 w-4" />
                      </button>
                    </Tooltip>
                    <Tooltip label="Edit lead">
                      <button type="button" aria-label={`Edit ${l.company.name}`} onClick={stop(() => onEdit(l))} className={iconButton}>
                        <Pencil className="h-4 w-4" />
                      </button>
                    </Tooltip>
                    <RowMenu lead={l} target={t} closed={closed} canReassign={canReassign} actions={actions} />
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

export function RowMenu({ lead, target, closed, canReassign, actions }: { lead: Lead; target: LeadTarget; closed: boolean; canReassign: boolean; actions: Actions }) {
  const router = useRouter();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const item = "pressable flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100";
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <>
      <Tooltip label="More actions">
        <button ref={anchor} type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={iconButton}>
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </Tooltip>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={208} label="More actions">
        <div role="menu" className="-m-1.5 space-y-0.5">
          <button role="menuitem" type="button" className={item} onClick={run(() => router.push(dealHref(lead)))}><ExternalLink className="h-4 w-4 text-slate-400" /> {lead.pipeline === "client" ? "Open project" : "Open lead"}</button>
          {!closed && <button role="menuitem" type="button" className={item} onClick={run(() => actions.meeting(target))}><CalendarPlus className="h-4 w-4 text-slate-400" /> Schedule meeting</button>}
          {!closed && <button role="menuitem" type="button" className={item} onClick={run(() => actions.schedule(target))}><Bell className="h-4 w-4 text-slate-400" /> Set reminder</button>}
          <button role="menuitem" type="button" className={item} onClick={run(() => router.push(`/activity?lead=${lead.id}`))}><History className="h-4 w-4 text-slate-400" /> View activity</button>
          {canReassign && <button role="menuitem" type="button" className={item} onClick={run(() => actions.reassign(target))}><UserCog className="h-4 w-4 text-slate-400" /> Reassign</button>}
          {!closed && <button role="menuitem" type="button" className={cn(item, "text-red-600")} onClick={run(() => actions.close(target))}><Flag className="h-4 w-4" /> Close lead</button>}
        </div>
      </Popover>
    </>
  );
}

/**
 * The stage, changeable right from the row. Moving forward opens that stage's own dialog (meeting, minutes, quotation,
 * agreement), exactly as on the lead page, and the server checks the person may change this lead.
 * Closed leads show the stage only: Won comes from payment, and a lost lead is reopened from its page.
 */
export function StageCell({ lead, target, closed, actions }: { lead: Lead; target: LeadTarget; closed: boolean; actions: Actions }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (closed) return <StageBadge stage={lead.stage} />;
  const steps = PIPELINE_STAGES[lead.pipeline ?? "new_business"] as readonly StageKey[];
  const pick = (s: StageKey | "close") => {
    setOpen(false);
    if (s === "close") actions.close(target);
    else if (s !== lead.stage) actions.moveTo(target, s);
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Stage: ${STAGE_LABEL[lead.stage]}. Change stage`}
        onClick={() => setOpen((o) => !o)}
        className={cn("pressable inline-flex items-center gap-1 whitespace-nowrap rounded-full py-0.5 pl-2.5 pr-1.5 text-xs font-medium ring-brand/30 hover:ring-2", STAGE_TONE[lead.stage])}
      >
        {STAGE_LABEL[lead.stage]}<ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={232} label="Change stage">
        <div role="menu" className="-m-1.5 space-y-0.5">
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Change stage</p>
          {steps.map((s) => (
            <button key={s} role="menuitemradio" aria-checked={s === lead.stage} type="button" onClick={() => pick(s)} className={cn("pressable flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-100", s === lead.stage ? "font-semibold text-brand" : "text-slate-700")}>
              <StageIcon stage={s} className={cn("h-4 w-4 shrink-0", s === lead.stage ? "text-brand" : "text-slate-400")} />
              <span className="flex-1 truncate">{STAGE_LABEL[s]}</span>
              {s === lead.stage && <Check className="h-4 w-4 shrink-0" />}
            </button>
          ))}
          <div className="my-1 border-t border-slate-100" />
          <button role="menuitem" type="button" onClick={() => pick("close")} className="pressable flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
            <Flag className="h-4 w-4 shrink-0" /> Close lead
          </button>
        </div>
      </Popover>
    </>
  );
}
