/**
 * What the Add / Edit Recipient panel collects and how it is checked. The steps, rules and messages are Gifting OS's
 * (its components/recipients/wizard/wizard-types.ts): keep the two in step.
 */
export type RecipientType = "EXTERNAL" | "INTERNAL";
export type AddressLabel = "PERMANENT" | "CURRENT" | "OFFICE";
export type GroupRef = { id: string; name: string };

export type Details = {
  name: string; mobile: string; email: string; company: string; recipientType: RecipientType;
  // CRM-only details, under "More details"
  relationship: string; isPrimary: boolean; designation: string; department: string; city: string;
  giftingOccasion: string; budget: string; birthdayBudget: string; anniversaryBudget: string; remark: string;
};
export type Occasion = { key: string; type: string; name: string; date: string; repeatAnnually: boolean; notes: string };
export type Preferences = { interests: string[]; brands: string[]; giftPreferences: string; dietary: string; avoid: string; instructions: string };
export type Address = { id?: string; label: AddressLabel; line1: string; line2: string; city: string; state: string; postalCode: string };
export type WizardData = {
  companyId: string;
  details: Details;
  groupIds: string[]; newGroupName: string;
  occasions: Occasion[];
  preferences: Preferences;
  permanent: Address; current: Address;
  /** The current address is the same as the permanent one, so only the permanent one is kept. */
  sameAddress: boolean;
  /** The user has seen the possible matches and says this is a different person. */
  allowDuplicate: boolean;
};

export const blankAddress = (label: AddressLabel): Address => ({ label, line1: "", line2: "", city: "", state: "", postalCode: "" });
export const EMPTY: WizardData = {
  companyId: "",
  details: { name: "", mobile: "", email: "", company: "", recipientType: "INTERNAL", relationship: "", isPrimary: false, designation: "", department: "", city: "", giftingOccasion: "", budget: "", birthdayBudget: "", anniversaryBudget: "", remark: "" },
  groupIds: [], newGroupName: "", occasions: [],
  preferences: { interests: [], brands: [], giftPreferences: "", dietary: "", avoid: "", instructions: "" },
  permanent: blankAddress("PERMANENT"), current: blankAddress("CURRENT"), sameAddress: false, allowDuplicate: false,
};

export const OCCASION_TYPES = ["Birthday", "Anniversary", "Work anniversary", "Custom"] as const;
export const COUNTRY_CODES = ["+91", "+1", "+44", "+971", "+65", "+61"];

let counter = 0;
export const newKey = () => `k${Date.now().toString(36)}${(counter++).toString(36)}`;

/** "+91 98765-43210", "9876543210" → "+919876543210". Anything that isn't a plausible number comes back as typed. */
export function normaliseMobile(value: string): string {
  const compact = value.replace(/[\s()-]/g, "");
  return /^[6-9]\d{9}$/.test(compact) ? `+91${compact}` : compact;
}
const MOBILE_OK = /^\+?[1-9][0-9]{7,14}$/;
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type Errors = Record<string, string>;

export function validateDetails(data: WizardData, adding: boolean): Errors {
  const d = data.details;
  const errors: Errors = {};
  if (adding && !data.companyId) errors.companyId = "Please choose the client.";
  if (!d.name.trim()) errors.name = "Please enter the full name.";
  else if (d.name.trim().length > 200) errors.name = "That name is too long.";
  if (!d.mobile.trim()) errors.mobile = "Please enter the mobile number.";
  else if (!MOBILE_OK.test(normaliseMobile(d.mobile))) errors.mobile = "Enter a mobile number like 98765 43210.";
  if (d.email.trim() && !EMAIL_OK.test(d.email.trim())) errors.email = "Enter an email like name@company.com.";
  if (d.designation.length > 120) errors.designation = "Keep this under 120 characters.";
  for (const key of ["budget", "birthdayBudget", "anniversaryBudget"] as const) if (d[key].trim() && !(Number(d[key]) >= 0)) errors[key] = "Enter an amount.";
  return errors;
}

export const occasionLabel = (item: Pick<Occasion, "type" | "name">) => (item.type === "Custom" ? item.name.trim() || "Custom occasion" : item.type);

export function validateOccasion(item: Occasion, existing: Occasion[]): Errors {
  const errors: Errors = {};
  if (!item.date) errors.date = "Please pick a date.";
  if (item.type === "Custom" && !item.name.trim()) errors.name = "Give this occasion a name.";
  if (item.type === "Birthday" && existing.some((o) => o.type === "Birthday" && o.key !== item.key)) errors.type = "A birthday is already added.";
  const label = occasionLabel(item).toLowerCase();
  if (item.date && existing.some((o) => o.key !== item.key && o.date === item.date && occasionLabel(o).toLowerCase() === label)) errors.date = "This occasion is already added.";
  return errors;
}

export const isBlank = (a: Address) => ![a.line1, a.line2, a.city, a.postalCode].some((v) => v.trim());

/** Checks whichever of the two addresses has been started. Both are optional. */
export function validateAddresses(data: WizardData): Errors {
  const errors: Errors = {};
  const check = (prefix: string, a: Address) => {
    if (isBlank(a)) return;
    if (a.line1.trim().length < 3) errors[`${prefix}.line1`] = "Please enter the address.";
    if (!a.city.trim()) errors[`${prefix}.city`] = "Please enter the city.";
    if (!/^[0-9]{6}$/.test(a.postalCode.trim())) errors[`${prefix}.postalCode`] = "PIN code should be 6 digits.";
  };
  check("permanent", data.permanent);
  if (!data.sameAddress) check("current", data.current);
  return errors;
}

// ------------------------------------------------------------------------------------------------ draft
export const draftKey = (userId?: string) => `tofaa-recipient-draft:${userId ?? "me"}`;
export type SavedDraft = { data: WizardData; step: number; savedAt: string };

export function loadDraft(key: string): SavedDraft | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null") as SavedDraft | null;
    return parsed?.data ? { ...parsed, data: { ...EMPTY, ...parsed.data, details: { ...EMPTY.details, ...parsed.data.details } } } : null;
  } catch { return null; }
}
export function storeDraft(key: string, data: WizardData, step: number) {
  try { window.localStorage.setItem(key, JSON.stringify({ data, step, savedAt: new Date().toISOString() } satisfies SavedDraft)); } catch { /* private mode: the panel still works */ }
}
export function clearDraft(key: string) { try { window.localStorage.removeItem(key); } catch { /* nothing to clear */ } }
/** Has the person typed anything worth keeping? */
export const hasContent = (data: WizardData) => JSON.stringify({ ...data, companyId: "", allowDuplicate: false }) !== JSON.stringify(EMPTY);
