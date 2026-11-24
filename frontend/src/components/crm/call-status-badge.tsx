import { CalendarCheck, CalendarClock, Phone, PhoneForwarded, PhoneMissed, PhoneOff, ThumbsDown, type LucideIcon } from "lucide-react";
import { formatDateTime, OUTCOME_LABEL, TAG_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

/** How each last-call outcome looks, so the status reads at a glance on cards and in the table. */
const LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  not_reachable: { icon: PhoneMissed, tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  call_back_later: { icon: PhoneForwarded, tone: "bg-sky-50 text-sky-700 ring-sky-200" },
  future_requirement: { icon: CalendarClock, tone: "bg-violet-50 text-violet-700 ring-violet-200" },
  interested: { icon: CalendarCheck, tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  not_interested: { icon: ThumbsDown, tone: "bg-rose-50 text-rose-700 ring-rose-200" },
  wrong_contact: { icon: PhoneOff, tone: "bg-slate-100 text-slate-600 ring-slate-200" },
};

/** Options for the "Call status" filter. "none" = no call logged yet. */
export const CALL_STATUS_OPTIONS = [
  ...Object.keys(LOOK).map((value) => ({ value, label: OUTCOME_LABEL[value] })),
  { value: "none", label: "Not called yet" },
];

/** Options for the tag filter. */
export const TAG_OPTIONS = Object.entries(TAG_LABEL).map(([value, label]) => ({ value, label }));

type Props = { outcome?: string | null; at?: string | null; attempts?: number | null; className?: string };

/** The outcome of the most recent logged call ("What happened?"), or "Not called yet". Not reachable shows the attempt count. */
export function CallStatusBadge({ outcome, at, attempts, className }: Props) {
  const look = outcome ? LOOK[outcome] : undefined;
  const Icon = look?.icon ?? Phone;
  const base = look ? OUTCOME_LABEL[outcome!] : "Not called yet";
  const label = outcome === "not_reachable" && attempts ? `${base} · ${attempts}` : base;
  const title = look ? `Last call: ${base}${outcome === "not_reachable" && attempts ? ` (${attempts} ${attempts === 1 ? "attempt" : "attempts"})` : ""}${at ? ` · ${formatDateTime(at)}` : ""}` : "No call logged yet";
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        look?.tone ?? "bg-white text-slate-400 ring-slate-200",
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Nurture (while the latest call is "Future requirement") and Cold (still not reachable after the retry limit). */
export function LeadTags({ tags, outcome, cold, className }: { tags?: string[] | null; outcome?: string | null; cold?: boolean; className?: string }) {
  const shown = [...(outcome === "future_requirement" && tags?.includes("nurture") ? ["nurture"] : []), ...(cold ? ["cold"] : [])];
  if (!shown.length) return null;
  return (
    <>
      {shown.map((t) => (
        <span key={t} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", t === "cold" ? "bg-sky-50 text-sky-700" : "bg-indigo-50 text-indigo-700", className)}>
          {TAG_LABEL[t]}
        </span>
      ))}
    </>
  );
}
