/** Field rules shared by every form. The backend applies the same rules (core/validators.py). */

// Deliberately lenient: something@something.something. Test addresses (test@test.com, a@b.test, user+tag@x.io) pass.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MSG = "Enter a valid email address";
export const PHONE_MSG = "Enter a 10-digit mobile number";

export const isEmail = (v?: string | null) => !!v && EMAIL_RE.test(v.trim());

/** The 10-digit mobile number, or null. "+91 98765 43210", "09876 54321" and "98765-43210" all work. */
export function normalizePhone10(v?: string | null): string | null {
  let d = (v ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.length === 10 ? d : null;
}
export const isPhone10 = (v?: string | null) => normalizePhone10(v) !== null;

/** What a mobile box keeps while someone types or pastes: digits only, never more than 10. */
export function clampPhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length > 10) {
    if (d.length === 12 && d.startsWith("91")) d = d.slice(2); // pasted +91 number
    else if (d.length === 11 && d.startsWith("0")) d = d.slice(1); // pasted 0-prefixed number
    else d = d.slice(0, 10);
  }
  return d;
}

/** A sign-in box takes an email or a mobile number. Returns the message to show, or undefined when fine. */
export function identifierProblem(v: string): string | undefined {
  const t = v.trim();
  if (!t) return "Enter your email or mobile number";
  if (t.includes("@")) return isEmail(t) ? undefined : EMAIL_MSG;
  return isPhone10(t) ? undefined : "Enter a valid email or a 10-digit mobile number";
}
