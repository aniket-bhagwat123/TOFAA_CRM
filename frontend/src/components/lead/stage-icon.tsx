import { CalendarCheck, CircleDot, FileSignature, FileText, Flag, Handshake, ListChecks, PhoneCall, Sparkles, ThumbsDown, Trophy, type LucideIcon } from "lucide-react";
import type { StageKey } from "@/types/crm";

const ICONS: Record<StageKey, LucideIcon> = {
  new_lead: Sparkles, connected: PhoneCall, meeting_scheduled: CalendarCheck, requirement_received: ListChecks,
  quotation_sent: FileText, agreement_payment: FileSignature, closed_won: Trophy, closed_lost: ThumbsDown,
  project_follow_up: CircleDot, project_meeting: CalendarCheck, project_proposal: FileText, project_negotiation: Handshake,
};

export function StageIcon({ stage, className }: { stage: StageKey; className?: string }) {
  const Icon = ICONS[stage] ?? Flag;
  return <Icon className={className} aria-hidden="true" />;
}
