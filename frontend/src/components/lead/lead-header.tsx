"use client";
import { CALL_TONE, WHATSAPP_TONE } from "@/lib/contact-styles";
import { Bell, CalendarPlus, History, Mail, MessageCircle, Pencil, Phone, StickyNote, Trash2, UserCog } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { followUpLabel, STAGE_LABEL, STAGE_TONE } from "@/lib/format";
import { cn } from "@/lib/utils";
import { seesActivity } from "@/lib/roles";
import { useAppSelector } from "@/store/hooks";
import type { Lead } from "@/types/crm";
import { StageIcon } from "./stage-icon";

type Props = {
  lead: Lead;
  canReassign: boolean;
  canDelete?: boolean; // managers, admins, and the KAM who owns it
  onDelete?: () => void;
  onCall: () => void;
  onWhatsApp: () => void;
  onMeeting: () => void;
  onReminder: () => void;
  onEdit: () => void;
  onReassign: () => void;
  onNote: () => void;
};

// Quiet round icon buttons at the top right; each names itself in a tooltip.
const ICON = "pressable flex h-8 min-w-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium transition-colors sm:px-3";
// Soft fills, one colour per kind of action (the same colours Activity uses for notes, history, edits and owners).
const TONE = {
  note: "bg-amber-50 text-amber-600 hover:bg-amber-100",
  activity: "bg-sky-50 text-sky-600 hover:bg-sky-100",
  edit: "bg-violet-50 text-brand hover:bg-violet-100",
  reassign: "bg-emerald-50 text-emerald-600 hover:bg-emerald-100",
  remove: "bg-red-50 text-red-600 hover:bg-red-100",
};

/**
 * Who this is, how to reach them, what is next, and the actions. Quiet by design: one filled button (Call),
 * grey fills for the rest, facts as small label/value pairs instead of coloured panels.
 */
export function LeadHeader({ lead, canReassign, canDelete, onCall, onWhatsApp, onMeeting, onReminder, onEdit, onReassign, onNote, onDelete }: Props) {
  const closed = lead.stage === "closed_won" || lead.stage === "closed_lost";
  const fu = followUpLabel(lead.nextFollowUp);
  const role = useAppSelector((st) => st.auth.session?.profile.role); // KAMs never see Activity

  const followUpTone = closed ? "text-slate-400" : fu.tone === "text-slate-500" ? "text-slate-900" : fu.tone;

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm sm:p-5">
      {/* identity */}
      <div className="flex items-start gap-3.5">
        <Avatar src={lead.contact.photoUrl} name={lead.company.name} size="md" square className="h-12 w-12 rounded-xl border border-slate-200/80 bg-white object-contain p-0.5" />
        <div className="min-w-0 flex-1">
          {lead.pipeline === "client" && (
            <Link href={`/clients/${lead.companyId}`} className="block truncate text-[12px] font-semibold uppercase tracking-wide text-brand hover:underline">Client project · {lead.company.name}</Link>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900">{lead.pipeline === "client" && lead.projectTitle ? lead.projectTitle : lead.company.name}</h1>
            <span className={cn("hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold sm:inline-flex", STAGE_TONE[lead.stage])}>
              <StageIcon stage={lead.stage} className="h-3 w-3" />{STAGE_LABEL[lead.stage]}
            </span>
          </div>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span className="truncate font-medium text-slate-700">{lead.contact.name}</span>
            {lead.contact.designation && <span className="truncate">{lead.contact.designation}</span>}
            {lead.contact.phone && (
              <>
                <span className="text-slate-300">·</span>
                <a href={`tel:${lead.contact.phone}`} className="inline-flex shrink-0 items-center gap-1 hover:text-brand"><Phone className="h-3 w-3" />{lead.contact.phone}</a>
                {/* with two numbers on file, the main one is the newer: it replaced a wrong number */}
                {lead.contact.altPhone && <span className="-ml-1 rounded bg-emerald-50 px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-emerald-700" title="Latest number">New</span>}
              </>
            )}
            {lead.contact.email && <><span className="text-slate-300">·</span><a href={`mailto:${lead.contact.email}`} className="inline-flex min-w-0 items-center gap-1 hover:text-brand"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{lead.contact.email}</span></a></>}
          </p>
          {/* the earlier contact, under the new one */}
          {lead.contact.altPhone && (
            <p className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-slate-400">
              {lead.contact.altName && <span className="truncate">{lead.contact.altName}</span>}
              {lead.contact.altName && <span className="text-slate-300">·</span>}
              <a href={`tel:${lead.contact.altPhone}`} title="Earlier number" className="inline-flex shrink-0 items-center gap-1 hover:text-brand"><Phone className="h-3 w-3" />{lead.contact.altPhone}</a>
              <span className="rounded bg-slate-100 px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-slate-500">Old</span>
            </p>
          )}
        </div>

        {/* titled buttons; on phones the label hides and the icon stays */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={onNote} aria-label="Add a note" title="Add a note" className={cn(ICON, TONE.note)}><StickyNote className="h-4 w-4 shrink-0" /><span className="hidden sm:inline">Add note</span></button>
          {seesActivity(role) && <Link href={`/activity?lead=${lead.id}`} aria-label="View activity" title="View activity" className={cn(ICON, TONE.activity)}><History className="h-4 w-4 shrink-0" /><span className="hidden sm:inline">Activity</span></Link>}
          <button type="button" onClick={onEdit} aria-label="Edit details" title="Edit details" className={cn(ICON, TONE.edit)}><Pencil className="h-4 w-4 shrink-0" /><span className="hidden sm:inline">Edit</span></button>
          {canReassign && (
            <button type="button" onClick={onReassign} aria-label="Reassign" title="Reassign" className={cn(ICON, TONE.reassign)}><UserCog className="h-4 w-4 shrink-0" /><span className="hidden sm:inline">Reassign</span></button>
          )}
          {canDelete && onDelete && lead.stage !== "closed_won" && (
            <button type="button" onClick={onDelete} aria-label="Delete" title="Delete (only if added by mistake)" className={cn(ICON, TONE.remove)}><Trash2 className="h-4 w-4 shrink-0" /><span className="hidden sm:inline">Delete</span></button>
          )}
        </div>
      </div>

      {/* facts, then actions: one line on desktop */}
      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 lg:flex-row lg:items-center lg:justify-between">
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold sm:hidden", STAGE_TONE[lead.stage])}>
            <StageIcon stage={lead.stage} className="h-3 w-3" />{STAGE_LABEL[lead.stage]}
          </span>
          <div className="flex items-baseline gap-1.5"><dt className="text-slate-500">Next follow-up</dt><dd className={cn("font-semibold", followUpTone)}>{closed ? "Closed" : fu.text}</dd></div>
          <div className="flex min-w-0 items-baseline gap-1.5"><dt className="text-slate-500">Owner</dt><dd className="truncate font-semibold text-slate-900">{lead.owner?.fullName ?? "Unassigned"}</dd></div>
          {lead.stage === "closed_lost" && lead.lostReason && <div className="flex items-baseline gap-1.5"><dt className="text-slate-500">Lost</dt><dd className="font-semibold text-red-600">{lead.lostReason}</dd></div>}
        </dl>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button onClick={onCall} disabled={!lead.contact.phone || closed} className={cn("min-h-9 rounded-lg px-3.5 py-1.5", CALL_TONE)}><Phone className="h-4 w-4" />Call</Button>
          <Button variant="tinted" onClick={onWhatsApp} disabled={!lead.contact.phone} className={cn("min-h-9 rounded-lg px-3.5 py-1.5", WHATSAPP_TONE)}><MessageCircle className="h-4 w-4" />WhatsApp</Button>
          <Button variant="tinted" onClick={onMeeting} disabled={closed} className="min-h-9 rounded-lg px-3.5 py-1.5"><CalendarPlus className="h-4 w-4" />Meeting</Button>
          <Button variant="tinted" onClick={onReminder} disabled={closed} className="min-h-9 rounded-lg px-3.5 py-1.5"><Bell className="h-4 w-4" />Reminder</Button>
        </div>
      </div>
    </section>
  );
}
