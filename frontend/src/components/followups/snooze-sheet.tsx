"use client";
import { AlarmClock, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { VoiceTextarea } from "@/components/crm/voice-textarea";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Sheet } from "@/components/ui/sheet";
import { fieldErrors } from "@/lib/api-errors";
import { formatDate, formatTime, istInputToIso, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { FollowUpItem } from "@/types/crm";

/** Snoozes before a follow-up is flagged "Repeatedly postponed" to the manager (same as the server). */
export const REPEAT_LIMIT = 3;

type Choice = "2h" | "tomorrow" | "3d" | "week" | "pick";
const CHOICES: { key: Choice; label: string }[] = [
  { key: "2h", label: "In 2 hrs" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "3d", label: "In 3 days" },
  { key: "week", label: "Next week" },
  { key: "pick", label: "Pick date" },
];
/** When a day snooze rings: the follow-up's own time of day, else the start of the morning. */
const DEFAULT_REMINDER = "10:00";
const hhmm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

type Props = { item: FollowUpItem | null; onClose: () => void; onDone: () => void };

/** Push a follow-up to later. A callback the client asked for needs a note; the 3rd snooze tells the manager. */
export function SnoozeSheet({ item, onClose, onDone }: Props) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [picked, setPicked] = useState(todayIso(1));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item) { setChoice(null); setPicked(todayIso(1)); setNote(""); setErrors({}); }
  }, [item]);

  const requested = !!item?.clientRequested;
  const reminderTime = item?.dueAt ? hhmm(item.dueAt) : DEFAULT_REMINDER;
  const reminderLabel = formatTime(istInputToIso(`${todayIso()}T${reminderTime}`)).toUpperCase();
  const count = item?.snoozeCount ?? 0;
  const name = item ? (item.projectTitle ? `${item.companyName} · ${item.projectTitle}` : item.companyName) : "";

  /** Two taps: the snooze icon, then a chip. Only "Pick date" (and a callback the client asked for, which needs a note) wait for the button. */
  function tap(c: Choice) {
    setChoice(c);
    setErrors({});
    if (c === "pick") return;
    if (requested && !note.trim()) return setErrors({ note: "The client asked for this callback. Add a note on why it moves." });
    void save(c);
  }

  async function save(choice: Choice | null) {
    if (!item || busy) return;
    const e: Record<string, string> = {};
    if (!choice) e.choice = "Pick when to come back to it";
    if (choice === "pick" && !picked) e.dueDate = "Pick a date";
    if (requested && !note.trim()) e.note = "The client asked for this callback. Add a note on why it moves.";
    if (Object.keys(e).length) return setErrors(e);

    let dueDate = picked;
    let dueAt: string | null = null;
    if (choice === "2h") { const at = new Date(Date.now() + 2 * 3600e3); dueAt = at.toISOString(); dueDate = istDay(at); }
    else if (choice === "tomorrow") dueDate = todayIso(1);
    else if (choice === "3d") dueDate = todayIso(3);
    else if (choice === "week") dueDate = todayIso(7);
    // A day snooze still gets a reminder time, so it rings: the follow-up's own time, or 10:00 AM.
    if (choice !== "2h") dueAt = istInputToIso(`${dueDate}T${reminderTime}`);

    setBusy(true);
    try {
      const res = await apiClient.post<{ snoozeCount: number; dueDate: string; dueAt: string | null }>(`/tasks/${item.id}/snooze`, { dueDate, dueAt, note: note.trim() || null });
      const n = res.data.snoozeCount;
      // Outside working hours the server moves it to the next working morning: say where it went.
      const where = res.data.dueAt ? `${formatDate(res.data.dueAt)}, ${formatTime(res.data.dueAt).toUpperCase()}` : formatDate(res.data.dueDate);
      if (n >= REPEAT_LIMIT) toast.warning(`Snoozed to ${where}. Moved ${n} times, so it is flagged "Repeatedly postponed" for your manager.`);
      else toast.success(`Snoozed to ${where}`);
      onClose();
      onDone();
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!item} title="Snooze follow-up" subtitle={name} icon={AlarmClock} tone="amber" onClose={onClose}>
      <div className="space-y-4">
        {count + 1 >= REPEAT_LIMIT && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {count >= REPEAT_LIMIT ? `Already snoozed ${count} times. Your manager can see it is repeatedly postponed.` : `This will be snooze ${count + 1}. It will be flagged "Repeatedly postponed" for your manager.`}
          </p>
        )}
        {/* The note comes first: a chip saves at once, taking whatever note is written. */}
        <div>
          <VoiceTextarea label={requested ? "Why it moves (client requested)" : "Note (optional)"} value={note} onChange={(v) => { setNote(v); setErrors((x) => ({ ...x, note: "" })); }} rows={2} placeholder="Write a note" />
          {errors.note && <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{errors.note}</p>}
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Remind me<span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span></span>
          <div className="flex flex-wrap gap-2">
            {CHOICES.map((c) => (
              <button key={c.key} type="button" disabled={busy} aria-pressed={choice === c.key} onClick={() => tap(c.key)}
                className={cn("whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium disabled:opacity-60", choice === c.key ? "border-brand bg-brand-soft text-brand" : "border-slate-300 text-slate-700 hover:bg-slate-50")}>
                {c.label}
              </button>
            ))}
          </div>
          {errors.choice && <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{errors.choice}</p>}
        </div>
        {choice === "pick" && <DatePicker label="Date" required min={todayIso()} value={picked} onChange={(d) => { setPicked(d); setErrors((x) => ({ ...x, dueDate: "" })); }} error={errors.dueDate} />}
        {choice === "pick" && <Button onClick={() => void save(choice)} loading={busy} className="w-full">Snooze</Button>}
        {choice !== "pick" && <p className="text-center text-xs text-slate-400">{busy ? "Snoozing…" : `Tap a time to snooze. It rings as a reminder (day choices at ${reminderLabel}); outside working hours it moves to the next working morning.`}</p>}
      </div>
    </Sheet>
  );
}
