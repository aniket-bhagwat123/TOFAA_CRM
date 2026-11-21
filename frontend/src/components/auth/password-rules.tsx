const RULES = [
  { label: "8 or more characters", ok: (p: string) => p.length >= 8 },
  { label: "upper and lower case letters", ok: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: "a number", ok: (p: string) => /\d/.test(p) },
];

export const isStrongPassword = (p: string) => RULES.every((r) => r.ok(p));

/** The required-field message: says what a password needs, naming only what is still missing. */
export function passwordProblem(p: string): string | undefined {
  if (!p) return "Enter a new password";
  const missing = RULES.filter((r) => !r.ok(p)).map((r) => r.label);
  return missing.length ? `Password needs ${missing.join(", ")}` : undefined;
}
