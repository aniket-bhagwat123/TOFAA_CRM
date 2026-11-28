"use client";
import { useSyncExternalStore } from "react";

/** A detail page tells the top bar where it sits: "Leads › Momentum Tech Solutions". */
export type Crumb = { path: string; parent: { href: string; label: string }; middle?: { href: string; label: string }; label: string };

let current: Crumb | null = null;
const listeners = new Set<() => void>();

export function setCrumb(c: Crumb | null) {
  current = c;
  listeners.forEach((l) => l());
}

export function useCrumb(): Crumb | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current,
    () => null,
  );
}
