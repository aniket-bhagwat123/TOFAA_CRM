import type { Relationship } from "@/types/people";

/** Display names and pill colours shared by the People screens. */
export const RELATIONSHIPS: { value: Relationship; label: string; tone: string }[] = [
  { value: "CLIENT", label: "Client", tone: "bg-sky-50 text-sky-700" },
  { value: "EMPLOYEE", label: "Employee", tone: "bg-indigo-50 text-indigo-700" },
  { value: "PARTNER", label: "Partner", tone: "bg-violet-50 text-violet-700" },
  { value: "ADVISOR", label: "Advisor", tone: "bg-teal-50 text-teal-700" },
  { value: "VENDOR", label: "Vendor", tone: "bg-amber-50 text-amber-800" },
  { value: "FAMILY", label: "Family", tone: "bg-rose-50 text-rose-700" },
  { value: "SPOUSE", label: "Spouse", tone: "bg-rose-50 text-rose-700" },
  { value: "CHILD", label: "Child", tone: "bg-rose-50 text-rose-700" },
  { value: "PARENT", label: "Parent", tone: "bg-rose-50 text-rose-700" },
  { value: "SIBLING", label: "Sibling", tone: "bg-rose-50 text-rose-700" },
  { value: "FRIEND", label: "Friend", tone: "bg-emerald-50 text-emerald-700" },
  { value: "OTHER", label: "Other", tone: "bg-slate-100 text-slate-600" },
];
export const relationshipOf = (v?: string | null) => RELATIONSHIPS.find((r) => r.value === v);

export const LINK_TYPES = [
  { value: "SPOUSE", label: "Spouse" }, { value: "SON", label: "Son" }, { value: "DAUGHTER", label: "Daughter" },
  { value: "PARENT", label: "Parent" }, { value: "SIBLING", label: "Sibling" }, { value: "BUSINESS_ASSOCIATE", label: "Business associate" },
  { value: "COLLEAGUE", label: "Colleague" }, { value: "OTHER", label: "Other" },
];
export const ADDRESS_LABELS = [{ value: "OFFICE", label: "Office" }, { value: "CURRENT", label: "Current" }, { value: "PERMANENT", label: "Permanent" }];
export const UPCOMING = [{ value: "7", label: "Occasion in 7 days" }, { value: "30", label: "Occasion in 30 days" }, { value: "90", label: "Occasion in 90 days" }];
export const ACTIONS: Record<string, string> = { CREATE: "Added", IMPORT: "Imported", EDIT: "Edited", ARCHIVE: "Archived", RESTORE: "Restored", DELETE: "Deleted" };

/** "+919876543210" -> "98765 43210" for Indian numbers; others as stored. */
export function mobileText(m?: string | null): string {
  if (!m) return "";
  const d = m.replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? `${d.slice(2, 7)} ${d.slice(7)}` : m;
}
