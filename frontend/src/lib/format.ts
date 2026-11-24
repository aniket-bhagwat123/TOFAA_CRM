import type { StageKey } from "@/types/crm";

const IST = "Asia/Kolkata";

export const STAGE_LABEL: Record<StageKey, string> = {
  new_lead: "New Lead",
  connected: "Connected",
  meeting_scheduled: "Meeting Scheduled",
  requirement_received: "Requirement Received",
  quotation_sent: "Quotation Sent",
  sampling: "Sampling",
  agreement_payment: "Agreement & Payment",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
  project_follow_up: "Follow-up",
  project_meeting: "Meeting",
  project_proposal: "Proposal",
  project_negotiation: "Negotiation",
};

export const STAGE_TONE: Record<StageKey, string> = {
  new_lead: "bg-slate-100 text-slate-700",
  connected: "bg-sky-100 text-sky-800",
  meeting_scheduled: "bg-indigo-100 text-indigo-800",
  requirement_received: "bg-violet-100 text-violet-800",
  quotation_sent: "bg-amber-100 text-amber-800",
  sampling: "bg-teal-100 text-teal-800",
  agreement_payment: "bg-orange-100 text-orange-800",
  closed_won: "bg-emerald-100 text-emerald-800",
  closed_lost: "bg-red-100 text-red-700",
  project_follow_up: "bg-slate-100 text-slate-700",
  project_meeting: "bg-indigo-100 text-indigo-800",
  project_proposal: "bg-amber-100 text-amber-800",
  project_negotiation: "bg-orange-100 text-orange-800",
};

export const BAND_LABEL: Record<string, string> = {
  under_1l: "Under ₹1L",
  "1_5l": "₹1–5L",
  "5_20l": "₹5–20L",
  "20l_plus": "₹20L+",
};

export const OUTCOME_LABEL: Record<string, string> = {
  not_reachable: "Not reachable",
  call_back_later: "Call back later",
  future_requirement: "Future requirement",
  interested: "Interested",
  not_interested: "Not interested",
  wrong_contact: "Wrong contact",
  // names used before the call buttons changed (old timeline entries, until the migration renames them)
  connected: "Connected",
  no_answer: "No answer",
  wrong_number: "Wrong number",
};
/** Lead tags set by call outcomes. */
export const TAG_LABEL: Record<string, string> = { nurture: "Nurture", cold: "Cold" };

/** Today in IST as YYYY-MM-DD (the CRM works in Indian time). */
export function todayIso(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
}

/** Next Monday–Friday after today, as YYYY-MM-DD. */
export function nextBusinessDayIso(): string {
  for (let i = 1; i < 8; i++) {
    const iso = todayIso(i);
    const day = new Date(`${iso}T12:00:00+05:30`).getDay();
    if (day !== 0 && day !== 6) return iso;
  }
  return todayIso(1);
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00+05:30` : iso);
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "numeric", month: "short" }).format(d);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function isOverdue(iso?: string | null): boolean {
  return !!iso && iso < todayIso();
}

export function followUpLabel(iso?: string | null): { text: string; tone: string } {
  if (!iso) return { text: "No next action", tone: "text-red-600" };
  const today = todayIso();
  if (iso < today) return { text: `Overdue · ${formatDate(iso)}`, tone: "text-red-600" };
  if (iso === today) return { text: "Today", tone: "text-amber-600" };
  return { text: formatDate(iso), tone: "text-slate-500" };
}

export function telHref(phone?: string | null): string | undefined {
  return phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : undefined;
}

/** Local datetime-local value ("2026-11-20T15:30") to an ISO string with the IST offset. */
export function istInputToIso(value: string): string {
  return new Date(`${value}:00+05:30`).toISOString();
}

/** The stages of each pipeline, in order (the closed ones are shared). */
export const PIPELINE_STAGES = {
  new_business: ["new_lead", "connected", "meeting_scheduled", "requirement_received", "quotation_sent", "sampling", "agreement_payment"],
  client: ["project_follow_up", "project_meeting", "project_proposal", "project_negotiation"],
} as const;

/** Open WhatsApp with this number (India +91 when no country code). Messages about a project are logged from the project. */
export function openWhatsApp(phone?: string | null, text?: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return;
  const full = digits.length === 10 ? `91${digits}` : digits;
  window.open(`https://wa.me/${full}${text ? `?text=${encodeURIComponent(text)}` : ""}`, "_blank", "noopener");
}
