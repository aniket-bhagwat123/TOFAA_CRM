"use client";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { fieldErrors } from "@/lib/api-errors";
import { nextBusinessDayIso } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import { DateChips } from "./date-chips";
import { VoiceTextarea } from "./voice-textarea";

type Props = { task: { id: string; name: string } | null; onClose: () => void; onDone: () => void };

/** Finish a task without a call (for example a WhatsApp follow-up): quick outcome and next date. */
export function CompleteSheet({ task, onClose, onDone }: Props) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState(nextBusinessDayIso());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function save() {
    if (!task) return;
    if (!date) return setErr("Pick the next follow-up date");
    setBusy(true);
    try {
      await apiClient.post(`/tasks/${task.id}/complete`, { nextFollowUp: date || null, outcome: note.trim() || null });
      toast.success("Done");
      setNote("");
      onClose();
      onDone();
    } catch (e) {
      setErr(fieldErrors(e).nextFollowUp);
      if (!fieldErrors(e).nextFollowUp) toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!task} title="Complete task" subtitle={task?.name} icon={CheckCircle2} tone="emerald" onClose={onClose}>
      <div className="space-y-4">
        <VoiceTextarea label="What happened? (optional)" value={note} onChange={setNote} rows={2} placeholder="Write a note" />
        <DateChips label="Next follow-up" required value={date} onChange={(d) => { setDate(d); setErr(undefined); }} error={err} />
        <Button onClick={save} loading={busy} className="w-full">Save</Button>
      </div>
    </Sheet>
  );
}
