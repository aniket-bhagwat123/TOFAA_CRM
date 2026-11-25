"use client";
import { AlarmClock, AlertTriangle, CalendarClock, ClipboardCheck, MapPin, MessageCircle, Phone, Repeat, UserRoundCheck, Video } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/components/ui/stage-badge";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDate, formatTime } from "@/lib/format";
import { inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { FollowUpItem } from "@/types/crm";
import { REPEAT_LIMIT } from "./snooze-sheet";

export type ColumnKey = "overdue" | "today" | "tomorrow" | "laterThisWeek" | "later";

/** The task type chip: what kind of work the follow-up is. */
export const KIND_LABEL: Record<string, string> = { call: "Call", follow_up: "Follow-up", meeting: "Meeting", whatsapp: "WhatsApp", other: "Task" };
export const kindOf = (f: FollowUpItem) => (f.meeting ? "meeting" : f.kind);
export const dealName = (f: FollowUpItem) => (f.projectTitle ? `${f.companyName} · ${f.projectTitle}` : f.companyName);

const IST = "Asia/Kolkata";
const weekday = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: IST, weekday: "short" }).format(new Date(`${iso}T12:00:00+05:30`));
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
export const clock = (iso: string) => formatTime(iso).toUpperCase(); // "4:00 PM"

/**
 * The date chip shows the due time, not the column's own name: "4:00 PM", "Any time", "Missed · 4:00 PM",
 * "2 days overdue", or "Thu, 20 Nov · 4:00 PM" in Later this week / Later (and in the list), where the day is not implied.
 */
export function whenLabel(f: FollowUpItem, column: ColumnKey, today: string, withDay = false): string {
  const at = f.meeting?.startsAt ?? f.dueAt ?? null;
  const time = at ? clock(at) : null;
  if (column === "overdue") {
    const late = daysBetween(f.dueDate, today);
    if (late <= 0) return time ? `Missed · ${time}` : "Missed";
    return late === 1 ? "1 day overdue" : `${late} days overdue`;
  }
  if (column === "laterThisWeek" || column === "later" || withDay) {
    const day = column === "today" ? "Today" : column === "tomorrow" ? "Tomorrow" : `${weekday(f.dueDate)}, ${formatDate(f.dueDate)}`;
    return `${day}${time ? ` · ${time}` : ""}`;
  }
  return time ?? "Any time";
}

/** Overdue this many days or more: the manager has been told (the backend's escalation rule). */
export const ESCALATE_AFTER_DAYS = 3;
export const isEscalated = (f: FollowUpItem, today: string) => daysBetween(f.dueDate, today) >= ESCALATE_AFTER_DAYS;

/** Due moment for sorting: the meeting time, the due time, or the end of the due day. */
export const dueMs = (f: FollowUpItem) => Date.parse(f.meeting?.startsAt ?? f.dueAt ?? `${f.dueDate}T23:59:59+05:30`);

/** "Attempt 3 of 6": only while the lead is still being reached (it has unanswered calls). */
export function attemptLabel(f: FollowUpItem): string | null {
  const n = f.callAttempts ?? 0;
  const max = f.maxAttempts ?? 0;
  if (!n || !max || !(f.stage === "new_lead" || f.stage === "connected")) return null;
  return `Attempt ${Math.min(n + 1, max)} of ${max}`;
}

/** The card's info line: attempt count, Warm or Cold, Nurture, expected value. */
export function InfoLine({ f, className }: { f: FollowUpItem; className?: string }) {
  const attempt = attemptLabel(f);
  if (!attempt && !f.temperature && !f.nurture && !f.dealValue) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500", className)}>
      {attempt && <span className="font-medium text-slate-700">{attempt}</span>}
      {f.temperature && (
        <>{attempt && <Dot />}<span className={cn("font-semibold", f.temperature === "cold" ? "text-sky-700" : "text-orange-600")}>{f.temperature === "cold" ? "Cold" : "Warm"}</span></>
      )}
      {f.nurture && <><Dot /><span className="font-medium text-indigo-700">Nurture</span></>}
      {!!f.dealValue && <><Dot /><span className="font-medium text-slate-700" title="Expected value">{inrShort(f.dealValue)}</span></>}
    </div>
  );
}
const Dot = () => <span aria-hidden="true" className="text-slate-300">·</span>;

const chip = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold";

/** Stage chip; a client follow-up (no deal) shows the company type, Direct or OS. */
export const StageChip = ({ f }: { f: Pick<FollowUpItem, "stage" | "companyKind"> }) =>
  f.stage ? <StageBadge stage={f.stage} className="py-1" /> : <span className={cn(chip, "bg-slate-100 text-slate-700")} title="Company type">{f.companyKind === "os" ? "OS" : "Direct"}</span>;
export const KindChip = ({ f }: { f: FollowUpItem }) => <span className={cn(chip, "bg-indigo-50 text-indigo-700")}>{KIND_LABEL[kindOf(f)] ?? "Follow-up"}</span>;

/** Tag column: Warm or Cold, and Nurture. */
export function TagChips({ f }: { f: FollowUpItem }) {
  if (!f.temperature && !f.nurture) return <span className="text-slate-300">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {f.temperature && <span className={cn(chip, f.temperature === "cold" ? "bg-sky-50 text-sky-700" : "bg-orange-50 text-orange-700")}>{f.temperature === "cold" ? "Cold" : "Warm"}</span>}
      {f.nurture && <span className={cn(chip, "bg-indigo-50 text-indigo-700")}>Nurture</span>}
    </div>
  );
}

export function TypeChips({ f, when, late }: { f: FollowUpItem; when: string; late: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StageChip f={f} />
      <KindChip f={f} />
      <span className={cn(chip, late ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700")}>
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />{when}
      </span>
    </div>
  );
}

/**
 * At most one warning per card, the most important: a missed client callback, then escalated, then postponed.
 * "Client requested" (not missed) is information, not a warning, so it can sit next to one.
 */
export function FlagChips({ f, late, escalated: isEscalated }: { f: FollowUpItem; late: boolean; escalated?: boolean }) {
  const requestedMissed = !!f.clientRequested && late;
  const warning = requestedMissed ? "missed" : isEscalated ? "escalated" : (f.snoozeCount ?? 0) >= REPEAT_LIMIT ? "postponed" : null;
  const postponed = warning === "postponed";
  const escalated = warning === "escalated";
  if (!f.clientRequested && !warning) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {escalated && (
        <span className={cn(chip, "bg-red-50 text-red-700")} title={`Overdue ${ESCALATE_AFTER_DAYS}+ days: the manager has been notified`}>
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Escalated to manager
        </span>
      )}
      {f.clientRequested && (
        <span className={cn(chip, requestedMissed ? "bg-red-600 text-white" : "bg-sky-50 text-sky-700")}>
          <UserRoundCheck className="h-3.5 w-3.5" aria-hidden="true" />{requestedMissed ? "Client requested · missed" : "Client requested"}
        </span>
      )}
      {postponed && (
        <span className={cn(chip, "bg-amber-50 text-amber-800")} title={`Moved later ${f.snoozeCount} times`}>
          <Repeat className="h-3.5 w-3.5" aria-hidden="true" />Repeatedly postponed
        </span>
      )}
    </div>
  );
}

export type CardActions = { onOpen: () => void; onCall: () => void; onWhatsApp: () => void; onLog: () => void; onSnooze: () => void };

/** Call, WhatsApp and Log outcome, in one row. Used by the board card and the list. */
export function ActionRow({ f, onCall, onWhatsApp, onLog, compact, snooze }: Pick<CardActions, "onCall" | "onWhatsApp" | "onLog"> & { f: FollowUpItem; compact?: boolean; snooze?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Tooltip label={f.phone ? `Call ${f.phone}` : "No phone number"} className={compact ? "shrink-0" : "min-w-fit flex-1"}>
        <Button onClick={onCall} disabled={!f.phone} className="h-9 min-h-0 w-full gap-1.5 whitespace-nowrap px-2.5 text-[13px]">
          <Phone className="h-4 w-4 shrink-0" />Call
        </Button>
      </Tooltip>
      <Tooltip label={f.phone ? "WhatsApp" : "No phone number"} className="shrink-0">
        <button type="button" aria-label="WhatsApp" disabled={!f.phone} onClick={onWhatsApp} className="pressable flex h-9 w-9 items-center justify-center rounded-full bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-35">
          <MessageCircle className="h-4 w-4" />
        </button>
      </Tooltip>
      {snooze}
      <Tooltip label="Log what happened" className={compact ? "shrink-0" : "min-w-fit flex-[1.4]"}>
        <Button variant="secondary" onClick={onLog} className="h-9 min-h-0 w-full gap-1.5 whitespace-nowrap px-2.5 text-[13px]">
          <ClipboardCheck className="h-4 w-4 shrink-0" />Outcome
        </Button>
      </Tooltip>
    </div>
  );
}

/**
 * The snooze icon. Amber when the follow-up has been snoozed (the tooltip says when it rings), and solid amber while
 * its snooze sheet is open, so it is clear which card is being snoozed.
 */
export function SnoozeButton({ f, onSnooze, side = "bottom", className, open }: { f: FollowUpItem; onSnooze: () => void; side?: "top" | "bottom"; className?: string; open?: boolean }) {
  const snoozed = (f.snoozeCount ?? 0) > 0;
  const rings = f.dueAt ? ` · rings ${formatDate(f.dueAt)}, ${clock(f.dueAt)}` : "";
  const label = snoozed ? `Snoozed ${f.snoozeCount}×${rings}` : "Snooze";
  return (
    <Tooltip label={label} side={side} align="end" className={cn("shrink-0", className)}>
      <button type="button" aria-label={label} aria-pressed={snoozed || open} onClick={onSnooze}
        className={cn(
          "pressable relative flex h-8 w-8 items-center justify-center rounded-full",
          open ? "bg-amber-500 text-white shadow-sm" : snoozed ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300" : "text-slate-500 hover:bg-amber-50 hover:text-amber-700",
        )}>
        <AlarmClock className="h-4 w-4" />
      </button>
    </Tooltip>
  );
}

type CardProps = CardActions & {
  f: FollowUpItem;
  when: string;
  late: boolean;
  escalated?: boolean;
  snoozeOpen?: boolean; // its snooze sheet is open
  showOwner: boolean;
  /** Drag to another column to reschedule. Off for meetings (their time belongs to the meeting). */
  onDragStart?: () => void;
};

export function FollowUpCard({ f, when, late, escalated, snoozeOpen, showOwner, onDragStart, onOpen, onCall, onWhatsApp, onLog, onSnooze }: CardProps) {
  const MeetingIcon = f.meeting?.kind === "online" ? Video : MapPin;
  const kind = kindOf(f);
  const showTitle = f.title && f.title !== "Meeting" && f.title !== KIND_LABEL[kind] && !/client requested/i.test(f.title);
  const requestedMissed = !!f.clientRequested && late;
  return (
    <article
      draggable={!!onDragStart}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", f.id); onDragStart?.(); }}
      className={cn("space-y-3 rounded-2xl border bg-white p-3.5 shadow-card", snoozeOpen && "ring-2 ring-amber-400", onDragStart && "cursor-grab active:cursor-grabbing", requestedMissed ? "border-red-300 ring-1 ring-red-200" : "border-slate-200/80")}
    >
      <div className="flex items-start gap-2">
        <button type="button" onClick={onOpen} className="block min-w-0 flex-1 text-left">
          <div className="t-body line-clamp-2 font-semibold leading-snug text-slate-900 hover:text-brand">{dealName(f)}</div>
          <div className="t-meta truncate">{f.contactName || "No contact"}</div>
        </button>
        {showOwner && f.ownerName && (
          <Tooltip label={f.ownerName} side="bottom" align="end" className="shrink-0"><Avatar src={f.ownerAvatarUrl} name={f.ownerName} size="xs" /></Tooltip>
        )}
        <SnoozeButton f={f} onSnooze={onSnooze} open={snoozeOpen} className="-mr-1 -mt-0.5" />
      </div>

      <FlagChips f={f} late={late} escalated={escalated} />

      <div className="space-y-1.5">
        <TypeChips f={f} when={when} late={late} />
        <InfoLine f={f} />
        {f.meeting && (f.meeting.location || f.meeting.kind === "online") && (
          <div className="t-meta flex min-w-0 items-center gap-1.5"><MeetingIcon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{f.meeting.kind === "online" ? "Online meeting" : f.meeting.location}</span></div>
        )}
        {showTitle && <p className="t-meta line-clamp-2">{f.title}</p>}
      </div>

      <div className="border-t border-slate-100 pt-3">
        <ActionRow f={f} onCall={onCall} onWhatsApp={onWhatsApp} onLog={onLog} />
      </div>
    </article>
  );
}
