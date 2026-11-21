/** Remembers who is mid-flow between screens (forgot -> reset). Session only, never the code or a password. */
const KEY = "tofaa-auth-identifier";

export const rememberIdentifier = (v: string) => {
  try { sessionStorage.setItem(KEY, v); } catch { /* private mode */ }
};
export const recallIdentifier = (): string => {
  try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; }
};
export const forgetIdentifier = () => {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
};
