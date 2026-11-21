"use client";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { nextBusinessDayIso } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import { DateChips } from "./date-chips";
import type { LeadTarget } from "./types";

type Props = { target: LeadTarget | null; onClose: () => void; onDone: () => void };

/** Give a lead its next dated action (or move the existing one). */
export function ScheduleSheet({ target, onClose, onDone }: Props) {
  const [date, setDate] = useState(nextBusinessDayIso());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function save() {
    if (!target) return;
    if (!date) return setErr("Pick the follow-up date");
    setBusy(true);
    try {
      await apiClient.post("/tasks", { leadId: target.leadId, dueDate: date });
      toast.success("Follow-up scheduled");
      onClose();
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!target} title="Next follow-up" subtitle={target?.name} icon={CalendarClock} tone="amber" onClose={onClose}>
      <div className="space-y-4">
        <DateChips label="Follow up on" required value={date} onChange={(d) => { setDate(d); setErr(undefined); }} error={err} />
        <Button onClick={save} loading={busy} className="w-full">Schedule</Button>
      </div>
    </Sheet>
  );
}
