import type { GiftRequest, GiftStatus } from "@/types/gifting";

export const GIFT_STATUSES: { value: GiftStatus; label: string; tone: string }[] = [
  { value: "SUBMITTED", label: "Submitted", tone: "bg-sky-50 text-sky-700" },
  { value: "IN_REVIEW", label: "In review", tone: "bg-indigo-50 text-indigo-700" },
  { value: "NEEDS_INFO", label: "Needs info", tone: "bg-amber-50 text-amber-800" },
  { value: "PROPOSAL_READY", label: "Proposal ready", tone: "bg-violet-50 text-violet-700" },
  { value: "CONFIRMED", label: "Confirmed", tone: "bg-teal-50 text-teal-700" },
  { value: "IN_PROGRESS", label: "In progress", tone: "bg-teal-50 text-teal-700" },
  { value: "DISPATCHED", label: "Dispatched", tone: "bg-emerald-50 text-emerald-700" },
  { value: "DELIVERED", label: "Delivered", tone: "bg-emerald-50 text-emerald-700" },
  { value: "CANCELLED", label: "Cancelled", tone: "bg-slate-100 text-slate-600" },
];
export const statusOf = (v?: string | null) => GIFT_STATUSES.find((s) => s.value === v) ?? { value: v, label: v ?? "—", tone: "bg-slate-100 text-slate-600" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayText = (v?: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? ""); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "—"; };
const rupees = (v: number | string) => `₹${Number(v).toLocaleString("en-IN")}`;

export function budgetText(r: GiftRequest): string {
  if (r.budgetMode === "TOFAA_RECOMMEND") return "TOFAA to recommend";
  if (r.budgetMin && r.budgetMax && Number(r.budgetMin) !== Number(r.budgetMax)) return `${rupees(r.budgetMin)} – ${rupees(r.budgetMax)}`;
  const one = r.budgetMax ?? r.requestedBudget ?? r.budgetMin;
  return one ? rupees(one) : "—";
}
