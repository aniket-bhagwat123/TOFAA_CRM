"use client";
import { BellRing, Phone, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/hooks/use-api";
import { formatTime, telHref } from "@/lib/format";
import { startRinging, stopRinging, unlockAudio } from "@/lib/ringtone";
import type { FollowUpItem } from "@/types/crm";
import { dealName, KIND_LABEL, kindOf } from "./followup-card";

const POLL_MS = 30_000;
const ACK_KEY = "followups.reminders.ack"; // reminders already dismissed: task id -> the due time it rang for
const MAX_ACKS = 200;

const readAcks = (): Record<string, string> => {
  try { return JSON.parse(window.localStorage.getItem(ACK_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
};
const writeAcks = (acks: Record<string, string>) => {
  try {
    const entries = Object.entries(acks).slice(-MAX_ACKS);
    window.localStorage.setItem(ACK_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* private mode: it may ring again after a reload */ }
};

/**
 * Rings when one of your follow-ups comes due (a snooze, a callback time, a task with a time), on any page.
 * The pop-up keeps ringing until it is dismissed; closing it stops the ring. A follow-up rings once per due time:
 * snoozing it again sets a new time, and it rings again then. In a background tab a system notification is shown too.
 */
export function ReminderCenter({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const api = useApi<FollowUpItem[]>(enabled ? "/follow-ups/reminders" : null);
  const [acks, setAcks] = useState<Record<string, string>>({});
  const reload = useRef(api.reload);
  reload.current = api.reload;
  const notified = useRef(new Set<string>());

  useEffect(() => setAcks(readAcks()), []);

  // Check every 30 seconds, and as soon as the window is back in focus.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => void reload.current();
    const t = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => { clearInterval(t); window.removeEventListener("focus", tick); };
  }, [enabled]);

  // Sound (and system notifications) need one tap on the page first: browsers block them before that.
  useEffect(() => {
    const first = () => {
      unlockAudio();
      if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    };
    window.addEventListener("pointerdown", first, { once: true });
    return () => window.removeEventListener("pointerdown", first);
  }, []);

  const due = useMemo(() => (api.data ?? []).filter((r) => r.dueAt && acks[r.id] !== r.dueAt), [api.data, acks]);

  // Ring while anything is waiting; stop the moment the last one is closed (or when leaving the app).
  useEffect(() => {
    if (due.length) startRinging();
    else stopRinging();
  }, [due.length]);
  useEffect(() => () => stopRinging(), []);

  // A tab in the background: also a system notification, once per reminder.
  useEffect(() => {
    for (const r of due) {
      const key = `${r.id}@${r.dueAt}`;
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      if (typeof document !== "undefined" && document.hidden && "Notification" in window && Notification.permission === "granted") {
        const n = new Notification("Follow-up reminder", { body: `${dealName(r)} · ${KIND_LABEL[kindOf(r)] ?? "Follow-up"} due ${formatTime(r.dueAt!).toUpperCase()}`, tag: key });
        n.onclick = () => { window.focus(); n.close(); };
      }
    }
  }, [due]);

  const dismiss = (items: FollowUpItem[]) => {
    const next = { ...acks };
    for (const r of items) next[r.id] = r.dueAt!;
    setAcks(next);
    writeAcks(next);
  };
  const open = (r: FollowUpItem) => { dismiss([r]); router.push("/follow-ups"); };
  const call = (r: FollowUpItem) => {
    dismiss([r]);
    const h = telHref(r.phone);
    router.push("/follow-ups"); // the follow-up is there to log the outcome after the call
    if (h) window.location.href = h;
  };

  if (!due.length) return null;
  return (
    <div role="alertdialog" aria-live="assertive" aria-label="Follow-up reminders"
      className="fixed inset-x-3 top-3 z-[60] space-y-2 sm:inset-x-auto sm:right-4 sm:top-4 sm:w-96">
      {due.slice(0, 3).map((r) => (
        <article key={r.id} className="rounded-2xl border border-amber-200 bg-white p-4 shadow-float ring-1 ring-amber-100">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 animate-pulse items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <BellRing className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Reminder · due {formatTime(r.dueAt!).toUpperCase()}</p>
              <p className="truncate text-sm font-semibold text-slate-900">{dealName(r)}</p>
              <p className="truncate text-xs text-slate-500">{KIND_LABEL[kindOf(r)] ?? "Follow-up"} · {r.contactName || "No contact"}{r.clientRequested ? " · Client requested" : ""}</p>
            </div>
            <button type="button" aria-label="Dismiss and stop the ring" onClick={() => dismiss([r])} className="pressable -mr-1 -mt-1 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={() => call(r)} disabled={!r.phone} className="h-9 min-h-0 flex-1 gap-1.5 whitespace-nowrap px-3 text-[13px]"><Phone className="h-4 w-4" />Call now</Button>
            <Button variant="secondary" onClick={() => open(r)} className="h-9 min-h-0 flex-1 whitespace-nowrap px-3 text-[13px]">Open follow-ups</Button>
          </div>
        </article>
      ))}
      {due.length > 1 && (
        <button type="button" onClick={() => dismiss(due)} className="pressable ml-auto block rounded-full bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900">
          Dismiss all {due.length} and stop ringing
        </button>
      )}
    </div>
  );
}
