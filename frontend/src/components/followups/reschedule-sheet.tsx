"use client";
import { CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { VoiceTextarea } from "@/components/crm/voice-textarea";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Sheet } from "@/components/ui/sheet";
import { TimePicker } from "@/components/ui/time-picker";
import { fieldErrors } from "@/lib/api-errors";
import { istInputToIso, todayIso } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import type { FollowUpItem } from "@/types/crm";
import { dealName } from "./followup-card";
import { REPEAT_LIMIT } from "./snooze-sheet";

export type RescheduleTarget = { item: FollowUpItem; date: string; label: string };

type Props = { target: RescheduleTarget | null; onClose: () => void; onDone: () => void };

/** A card dropped on another column: confirm the day, pick a time, and say why when the client asked for the callback. */
export function RescheduleSheet({ target, onClose, onDone }: Props) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) { setDate(target.date); setTime(""); setNote(""); setErrors({}); }
  }, [target]);

  const item = target?.item;
  const requested = !!item?.clientRequested;

  async function save() {
    if (!item) return;
    const e: Record<string, string> = {};
    if (!date) e.dueDate = "Pick a date";
    if (!time) e.time = "Pick a time";
    if (requested && !note.trim()) e.note = "The client asked for this callback. Add a note on why it moves.";
    const dueAt = date && time ? istInputToIso(`${date}T${time}`) : null;
    if (dueAt && Date.parse(dueAt) < Date.now()) e.time = "Pick a time later than now";
    if (Object.keys(e).length) return setErrors(e);

    setBusy(true);
    try {
      const res = await apiClient.post<{ snoozeCount: number }>(`/tasks/${item.id}/snooze`, { dueDate: date, dueAt, note: note.trim() || null, reason: "reschedule" });
      if (res.data.snoozeCount >= REPEAT_LIMIT && res.data.snoozeCount > (item.snoozeCount ?? 0)) toast.warning(`Moved later ${res.data.snoozeCount} times. It is flagged "Repeatedly postponed" for your manager.`);
      else toast.success("Rescheduled");
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
    <Sheet open={!!target} title={`Move to ${target?.label ?? ""}`} subtitle={item ? dealName(item) : ""} icon={CalendarClock} tone="sky" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker label="Date" required min={todayIso()} value={date} onChange={(d) => { setDate(d); setErrors((x) => ({ ...x, dueDate: "" })); }} error={errors.dueDate} />
          <TimePicker label="Time" required value={time} onChange={(t) => { setTime(t); setErrors((x) => ({ ...x, time: "" })); }} error={errors.time} />
        </div>
        <div>
          <VoiceTextarea label={requested ? "Why it moves (client requested)" : "Note (optional)"} value={note} onChange={(v) => { setNote(v); setErrors((x) => ({ ...x, note: "" })); }} rows={2} placeholder="Write a note" />
          {errors.note && <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{errors.note}</p>}
        </div>
        <Button onClick={save} loading={busy} className="w-full">Reschedule</Button>
      </div>
    </Sheet>
  );
}
