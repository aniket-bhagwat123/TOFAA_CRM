/** Gift request words and formats, as Gifting OS shows them (its components/gift-requests/shared.tsx). */
import { cn } from "@/lib/utils";
import type { GiftRequest, GiftStatus } from "@/types/gifting";

export const STATUS_META: Record<GiftStatus, { label: string; chip: string; dot: string }> = {
  SUBMITTED: { label: "Submitted", chip: "bg-indigo-50 text-indigo-700", dot: "bg-indigo-500" },
  IN_REVIEW: { label: "In review", chip: "bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  NEEDS_INFO: { label: "Needs information", chip: "bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  PROPOSAL_READY: { label: "Proposal ready", chip: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  CONFIRMED: { label: "Confirmed", chip: "bg-teal-50 text-teal-700", dot: "bg-teal-500" },
  IN_PROGRESS: { label: "In progress", chip: "bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  DISPATCHED: { label: "Dispatched", chip: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  DELIVERED: { label: "Delivered", chip: "bg-green-50 text-green-700", dot: "bg-green-500" },
  CANCELLED: { label: "Cancelled", chip: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
};
export const STATUS_ORDER = Object.keys(STATUS_META) as GiftStatus[];
export const metaOf = (status?: string | null) => STATUS_META[status as GiftStatus] ?? { label: status ?? "—", chip: "bg-slate-100 text-slate-600", dot: "bg-slate-400" };

export const INITIATED_VIA = [
  { value: "DIRECTOR_WHATSAPP", label: "Director (via WhatsApp)" }, { value: "DIRECTOR_EMAIL", label: "Director (via Email)" },
  { value: "DIRECTOR_CALL", label: "Director (via Call)" }, { value: "DIRECTOR_MEETING", label: "Director (in a meeting)" },
  { value: "HR_REQUEST", label: "HR request" }, { value: "SELF", label: "Self-initiated" }, { value: "OTHER", label: "Other" },
];
export const GIFT_PURPOSES = [
  { value: "BUSINESS_RELATIONSHIP", label: "Business Relationship" }, { value: "CLIENT_APPRECIATION", label: "Client Appreciation" },
  { value: "EMPLOYEE_RECOGNITION", label: "Employee Recognition" }, { value: "FESTIVE_GREETING", label: "Festive Greeting" },
  { value: "PERSONAL_CELEBRATION", label: "Personal Celebration" }, { value: "THANK_YOU", label: "Thank You" }, { value: "OTHER", label: "Other" },
];
export const RELATIONSHIP_OPTIONS = ["Business Partner", "Client", "Employee", "Leadership", "Vendor / Supplier", "Family", "Friend", "Other"];
export const INTERESTS = ["Sports", "Books", "Wellness", "Technology", "Luxury"];
export const GIFT_STYLES = [{ value: "PREMIUM", label: "Premium" }, { value: "THOUGHTFUL", label: "Thoughtful" }, { value: "PERSONALISED", label: "Personalised" }] as const;
export const labelFrom = (options: readonly { value: string; label: string }[], value?: string | null) => options.find((o) => o.value === value)?.label ?? value ?? "";

export const codeOf = (r: { requestCode?: string | null }) => (r.requestCode ? `#${r.requestCode}` : "—");
export const roleShort = (role?: string | null) => (role === "CLIENT" ? "EA" : role === "KAM" ? "KAM" : role === "SUPER_ADMIN" ? "TOFAA" : role ?? "");
export const inr = (v?: number | string | null) => (v === null || v === undefined || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
export const day = (v?: string | null) => (v ? new Date(v.length === 10 ? `${v}T00:00:00` : v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const shortDay = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
export const dayTime = (v: string) => `${shortDay(v)}, ${new Date(v).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

/** Reads "50000", "₹50,000" or "3,00,000 - 5,00,000" as a range. Null for empty, "invalid" for bad input. */
export function parseBudget(text: string): { min: number; max: number } | null | "invalid" {
  const cleaned = text.replace(/[₹,\s]/gi, "").replace(/(rs\.?|inr)/gi, "");
  if (!cleaned) return null;
  const parts = cleaned.split(/[-–—]|to/i).filter(Boolean);
  const numbers = parts.map(Number);
  if (!parts.length || parts.length > 2 || numbers.some((v) => !Number.isFinite(v) || v <= 0 || v > 10_000_000)) return "invalid";
  const [min, max = min] = numbers;
  return min > max ? "invalid" : { min, max };
}
export function budgetLabel(r: Pick<GiftRequest, "budgetMode" | "budgetMin" | "budgetMax" | "requestedBudget">) {
  if (r.budgetMode === "TOFAA_RECOMMEND") return "TOFAA to recommend";
  const max = r.budgetMax ?? r.requestedBudget;
  if (max === null || max === undefined || max === "") return "—";
  const min = r.budgetMin ?? max;
  return Number(min) === Number(max) ? inr(max) : `${inr(min)} – ${inr(max)}`;
}

export function StatusChip({ status }: { status: string }) {
  const meta = metaOf(status);
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", meta.chip)}><span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />{meta.label}</span>;
}
