/**
 * The client a KAM or admin has picked in the header of the OS-side screens. Kept per user in this browser and sent with
 * those screens' requests (services/api-client.ts), so they show that client only. Empty means all clients they may see.
 * The CRM side is never filtered by it.
 */
import { clearApiCache } from "./api-cache";

export type PickedClient = { id: string; name: string } | null;

const key = (userId: string) => `tofaa-client:${userId}`;
let owner: string | null = null;
let picked: PickedClient = null;
const listeners = new Set<() => void>();

/** Who picks their client in the header. */
export const picksInHeader = (role?: string) => role === "kam" || role === "admin";

/** Read this person's saved pick. Called before their screens render, so the first requests already carry it. */
export function loadPickedClient(userId: string, role: string) {
  const next = picksInHeader(role) ? userId : null;
  if (owner === next) return;
  owner = next;
  picked = null;
  if (!next) return;
  try { picked = JSON.parse(window.localStorage.getItem(key(next)) ?? "null") as PickedClient; } catch { /* storage unavailable: all clients */ }
}

export const pickedClient = () => picked;

/** The screens with the client picker: the OS modules that hold one client's data (gift ideas are shared; banners choose their clients themselves). */
export const hasClientPicker = (path: string) => ["/people", "/gifting-requests", "/os/home", "/os/calendar", "/os/events", "/os/activity"].some((p) => path === p || path.startsWith(`${p}/`));

/** The requests those screens narrow to the picked client. */
export const followsPickedClient = (url: string) => /^\/(people|people-groups|gifting-requests)([/?]|$)/.test(url);

export function pickClient(client: PickedClient) {
  if (!owner) return;
  picked = client;
  try { window.localStorage.setItem(key(owner), JSON.stringify(client)); } catch { /* not remembered, still applied */ }
  clearApiCache(); // cached screens belong to the previous pick
  listeners.forEach((l) => l());
}

export function onPickedClient(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
