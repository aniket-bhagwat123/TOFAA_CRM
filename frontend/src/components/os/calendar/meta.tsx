/** Gift Calendar words, icons and helpers, as Gifting OS shows them (its components/occasions/board), in CRM colours. */
import { Building2, Cake, CalendarDays, CheckCircle2, Clock, Coins, Gift, Heart, Hourglass, PartyPopper, Send, Star, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { CalendarDay, OccasionKind, OverviewItem, PlanStatus } from "@/types/os-modules";

export const WINDOW_DAYS = 90; // Gifting OS plans this far ahead for the CRM

export const STATUS_META: Record<PlanStatus, { label: string; chip: string; icon: LucideIcon }> = {
  NOT_PLANNED: { label: "Not planned", chip: "bg-amber-50 text-amber-800", icon: Clock },
  BUDGET_ALLOCATED: { label: "Budget allocated", chip: "bg-lime-50 text-lime-800", icon: Coins },
  REQUEST_SUBMITTED: { label: "Request submitted", chip: "bg-blue-50 text-blue-700", icon: Send },
  AWAITING_APPROVAL: { label: "Awaiting approval", chip: "bg-emerald-50 text-emerald-700", icon: Hourglass },
  IN_PROGRESS: { label: "In progress", chip: "bg-violet-50 text-violet-700", icon: Gift },
  DELIVERED: { label: "Delivered", chip: "bg-green-50 text-green-700", icon: CheckCircle2 },
};

export const KIND_META: Record<OccasionKind, { icon: LucideIcon; tint: string }> = {
  BIRTHDAY: { icon: Cake, tint: "bg-rose-50 text-rose-600" },
  ANNIVERSARY: { icon: Heart, tint: "bg-amber-50 text-amber-600" },
  WORK_ANNIVERSARY: { icon: Star, tint: "bg-amber-50 text-amber-600" },
  EVENT: { icon: CalendarDays, tint: "bg-brand-soft text-brand" },
  FESTIVAL: { icon: PartyPopper, tint: "bg-orange-50 text-orange-600" },
  COMPANY_EVENT: { icon: Building2, tint: "bg-brand-soft text-brand" },
};
export const kindMeta = (kind: string) => KIND_META[kind as OccasionKind] ?? KIND_META.EVENT;

export type ActionKind = "plan" | "create" | "request" | "details";
/** What the row's button does. `canRequest` is false for people who may not raise gift requests (a KAM). */
export function actionFor(item: OverviewItem, canRequest: boolean): { kind: ActionKind; label: string } {
  const open = item.requestId;
  switch (item.status) {
    case "NOT_PLANNED": return canRequest ? { kind: "plan", label: "Plan Gift" } : { kind: "details", label: "View Details" };
    case "BUDGET_ALLOCATED": return canRequest ? { kind: "create", label: "Create Request" } : { kind: "details", label: "View Details" };
    case "REQUEST_SUBMITTED":
    case "AWAITING_APPROVAL": return open ? { kind: "request", label: "View Request" } : { kind: "details", label: "View Details" };
    case "IN_PROGRESS": return open ? { kind: "request", label: "Track Progress" } : { kind: "details", label: "View Details" };
    default: return { kind: "details", label: "View Details" };
  }
}

export const isoOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const parseIso = (value: string) => new Date(`${value}T00:00:00`);
export const fullDay = (value: string) => parseIso(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const countdownText = (days: number) => days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : days > 0 ? `in ${days} days` : `${-days} days ago`;

/** A date the month view knows only the basics of (it is outside the planning window). */
export function fromCalendarDay(d: CalendarDay): OverviewItem {
  return {
    key: d.key, date: d.date, name: d.title, label: d.label, kind: d.kind as OccasionKind,
    sourceType: d.kind === "FESTIVAL" || d.kind === "COMPANY_EVENT" ? "COMPANY" : "RECIPIENT",
    daysAway: Math.round((parseIso(d.date).getTime() - parseIso(isoOf(new Date())).getTime()) / 86_400_000),
    recipientId: d.recipientId, eventId: d.eventId, occasionId: d.occasionId, isGlobal: d.kind === "FESTIVAL",
    accountId: d.accountId, accountName: d.accountName,
  };
}

export function StatusPill({ status }: { status?: PlanStatus }) {
  if (!status) return null;
  const { icon: Icon, label, chip } = STATUS_META[status];
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold", chip)}><Icon size={14} aria-hidden />{label}</span>;
}

/** The face of a row: the person's photo, or an icon for a company occasion. */
export function Subject({ item, large }: { item: OverviewItem; large?: boolean }) {
  if (item.sourceType === "RECIPIENT") return <Avatar name={item.name} src={item.recipientAvatarUrl} size={large ? "lg" : "md"} />;
  const { icon: Icon, tint } = kindMeta(item.kind);
  return <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-full", large ? "h-16 w-16" : "h-11 w-11", tint)}><Icon size={large ? 26 : 20} /></span>;
}
