import type { Session } from "@/types/api";
import { clearApiCache } from "./api-cache";

const KEY = "tofaa-session";
const REMEMBER_KEY = "tofaa-remember";

/**
 * "Remember me" decides where the session lives: localStorage survives closing the browser, sessionStorage ends with
 * the tab. Token refreshes keep writing to wherever the session already is.
 */
let remember: boolean | null = null;

const store = (): Storage => {
  if (remember === null) {
    try { remember = !!localStorage.getItem(KEY) || !sessionStorage.getItem(KEY); } catch { remember = true; }
  }
  return remember ? localStorage : sessionStorage;
};

/** Called at sign-in, before the session is saved. The choice is kept to pre-tick the box next time. */
export function setRemember(value: boolean) {
  remember = value;
  try { localStorage.setItem(REMEMBER_KEY, value ? "1" : "0"); } catch { /* storage unavailable */ }
}

export function rememberedChoice(): boolean {
  try { return localStorage.getItem(REMEMBER_KEY) === "1"; } catch { return false; }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (!s) {
      clearApiCache(); // signed out: never show this data to the next person
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
      remember = null;
      return;
    }
    const target = store();
    target.setItem(KEY, JSON.stringify(s));
    (target === localStorage ? sessionStorage : localStorage).removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
