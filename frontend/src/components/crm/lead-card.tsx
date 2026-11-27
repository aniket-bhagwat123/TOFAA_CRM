"use client";
import { CalendarClock, Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { BAND_LABEL, followUpLabel } from "@/lib/format";
import { inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/crm";
import { Avatar } from "../ui/avatar";
import { StageBadge } from "../ui/stage-badge";
import { ContactButtons } from "./contact-buttons";
import type { LeadTarget } from "./types";

export const leadTarget = (l: Lead): LeadTarget => ({
  leadId: l.id,
  name: l.projectTitle ? `${l.company.name} · ${l.projectTitle}` : `${l.company.name} · ${l.contact.name}`,
  phone: l.contact.phone,
  altPhone: l.contact.altPhone,
  contactName: l.contact.name,
  altName: l.contact.altName,
  stage: l.stage,
  pipeline: l.pipeline,
  companyId: l.companyId,
  lastCallOutcome: l.lastCallOutcome,
  callAttempts: l.callAttempts,
});

const isClosed = (l: Lead) => l.stage === "closed_won" || l.stage === "closed_lost";

const Chip = ({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "violet" }) => (
  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium", tone === "violet" ? "bg-brand-soft text-brand" : "bg-slate-100 text-slate-600")}>{children}</span>
);

const Line = ({ icon: Icon, children }: { icon: typeof Phone; children: React.ReactNode }) => (
  <div className="flex items-center gap-2 text-xs text-slate-600">
    <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
    <span className="truncate">{children}</span>
  </div>
);

type Props = { lead: Lead; showOwner?: boolean; onCall: (t: LeadTarget) => void; onWhatsApp: (t: LeadTarget) => void };

/**
 * One lead as a card: who, where it stands, how to reach them, what we know, and the next step with the
 * call and WhatsApp buttons. Cards in a row line up: the footer is always pinned to the bottom.
 */
export function LeadCard({ lead, showOwner, onCall, onWhatsApp }: Props) {
  const closed = isClosed(lead);
  const fu = followUpLabel(closed ? "9999-12-31" : lead.nextFollowUp);
  const target = leadTarget(lead);
  const hasFacts = !!(lead.dealValue || lead.valueBand || lead.source || lead.company.kind === "os");

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card transition-all hover:-translate-y-0.5 hover:shadow-float">
      <Link href={`/leads/${lead.id}`} className="flex flex-1 flex-col gap-3.5 p-4 outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
        <div className="flex items-start gap-3">
          <Avatar src={lead.contact.photoUrl} name={lead.contact.name} size="lg" square />
          <div className="min-w-0 flex-1">
            {lead.pipeline === "client" && lead.projectTitle && <div className="truncate text-[12px] font-semibold uppercase tracking-wide text-brand">{lead.projectTitle}</div>}
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900 group-hover:text-brand">{lead.company.name}</h3>
            <p className="mt-0.5 truncate text-sm text-slate-500">{lead.contact.name}{lead.contact.designation ? ` · ${lead.contact.designation}` : ""}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={lead.stage} />
          {lead.stage === "closed_lost" && lead.lostReason && <span className="text-xs text-red-600">{lead.lostReason}</span>}
        </div>

        <div className="space-y-1.5">
          {lead.contact.phone && <Line icon={Phone}>{lead.contact.phone}</Line>}
          {lead.contact.email && <Line icon={Mail}>{lead.contact.email}</Line>}
          {lead.company.city && <Line icon={MapPin}>{lead.company.city}</Line>}
          {!lead.contact.phone && !lead.contact.email && !lead.company.city && <p className="text-xs text-slate-300">No contact details yet</p>}
        </div>

        {hasFacts && (
          <div className="flex flex-wrap gap-1.5">
            {(lead.dealValue || lead.valueBand) && <Chip tone="violet">{lead.dealValue ? inrShort(lead.dealValue) : BAND_LABEL[lead.valueBand!]}{lead.valueSource ? ` · ${lead.valueSource}` : ""}</Chip>}
            {lead.source && <Chip>{lead.source}</Chip>}
            {lead.company.kind === "os" && <Chip>OS account</Chip>}
          </div>
        )}
      </Link>

      <footer className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          {closed ? (
            <span className="text-xs text-slate-400">Closed</span>
          ) : (
            <span className={cn("flex items-center gap-1.5 text-xs font-medium", fu.tone)}><CalendarClock className="h-3.5 w-3.5 shrink-0" />{fu.text}</span>
          )}
          {showOwner && (
            <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
              <Avatar name={lead.owner?.fullName} size="xs" className="!h-5 !w-5 !text-[10px]" />
              <span className="truncate">{lead.owner?.fullName ?? "Unassigned"}</span>
            </div>
          )}
        </div>
        <ContactButtons onCall={() => onCall(target)} onWhatsApp={() => onWhatsApp(target)} disabled={!lead.contact.phone} />
      </footer>
    </article>
  );
}
