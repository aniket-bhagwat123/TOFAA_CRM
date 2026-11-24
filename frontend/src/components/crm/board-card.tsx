"use client";
import { CalendarClock, MapPin, Phone } from "lucide-react";
import { BAND_LABEL, followUpLabel } from "@/lib/format";
import { inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";
import { Avatar } from "../ui/avatar";
import { StageBadge } from "../ui/stage-badge";
import { CallStatusBadge, LeadTags } from "./call-status-badge";

type Props = { lead: Lead; showOwner?: boolean; onDragStart: (id: string) => void; onOpen: () => void };

/** A pipeline card with enough on it to act without opening the lead: photo, name, how to reach them, value, next step, owner. */
export function BoardCard({ lead, showOwner, onDragStart, onOpen }: Props) {
  const closed = lead.stage === "closed_won" || lead.stage === "closed_lost";
  const fu = followUpLabel(closed ? "9999-12-31" : lead.nextFollowUp);
  // Call status matters while the lead is being reached; from Meeting Scheduled on, the meeting is what counts.
  const showCall = lead.pipeline !== "client" && (lead.stage === "new_lead" || lead.stage === "connected");
  return (
    <div
      draggable
      onDragStart={() => onDragStart(lead.id)}
      onClick={onOpen}
      className="cursor-grab space-y-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-card transition-shadow hover:shadow-float active:cursor-grabbing"
    >
      <div className="flex items-start gap-3">
        <Avatar src={lead.contact.photoUrl} name={lead.contact.name} size="md" square />
        <div className="min-w-0 flex-1">
          {lead.projectTitle && lead.pipeline === "client" && <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-brand">{lead.projectTitle}</div>}
          <div className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{lead.company.name}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500">{lead.contact.name}{lead.contact.designation ? ` · ${lead.contact.designation}` : ""}</div>
        </div>
      </div>

      {(lead.contact.phone || lead.company.city) && (
        <div className="space-y-1 text-xs text-slate-600">
          {lead.contact.phone && <div className="flex items-center gap-1.5 truncate"><Phone className="h-3 w-3 shrink-0 text-slate-400" />{lead.contact.phone}</div>}
          {lead.company.city && <div className="flex items-center gap-1.5 truncate"><MapPin className="h-3 w-3 shrink-0 text-slate-400" />{lead.company.city}</div>}
        </div>
      )}

      {(showCall || lead.dealValue || lead.valueBand || lead.source) && (
        <div className="flex flex-wrap gap-1.5">
          {showCall && <CallStatusBadge outcome={lead.lastCallOutcome} at={lead.lastCallAt} attempts={lead.callAttempts} />}
          {showCall && <LeadTags tags={lead.tags} outcome={lead.lastCallOutcome} cold={lead.cold} />}
          {(lead.dealValue || lead.valueBand) && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand" title={lead.valueSource ?? undefined}>{lead.dealValue ? inrShort(lead.dealValue) : BAND_LABEL[lead.valueBand!]}</span>}
          {lead.source && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{lead.source}</span>}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
        {closed ? <StageBadge stage={lead.stage} /> : <span className={cn("flex items-center gap-1.5 text-xs font-medium", fu.tone)}><CalendarClock className="h-3.5 w-3.5" />{fu.text}</span>}
        {showOwner && lead.owner?.fullName && <Avatar name={lead.owner.fullName} size="xs" />}
      </div>
    </div>
  );
}
