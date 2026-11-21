"use client";
import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { DatePicker } from "@/components/ui/date-picker";
import { SelectField } from "@/components/ui/select-field";
import { TimePicker } from "@/components/ui/time-picker";
import { Sheet } from "@/components/ui/sheet";
import { istInputToIso, todayIso } from "@/lib/format";
import { fieldErrors } from "@/lib/api-errors";
import { apiClient, errorMessage } from "@/services/api-client";
import type { LeadTarget } from "./types";

type Props = { target: LeadTarget | null; onClose: () => void; onDone: () => void };

export function MeetingSheet({ target, onClose, onDone }: Props) {
  const [when, setWhen] = useState(`${todayIso(1)}T11:00`);
  const [kind, setKind] = useState("physical");
  const [place, setPlace] = useState("");
  const [remind, setRemind] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save() {
    if (!target) return;
    if (!when.slice(0, 10) || !when.slice(11, 16)) return setErrors({ startsAt: "Pick the meeting date and time" });
    setBusy(true);
    try {
      await apiClient.post(`/leads/${target.leadId}/meetings`, {
        startsAt: istInputToIso(when),
        kind,
        location: kind === "physical" ? place || null : null,
        link: kind === "online" ? place || null : null,
        remindClient: remind,
      });
      toast.success("Meeting scheduled");
      setPlace("");
      onClose();
      onDone();
    } catch (e) {
      const fe = fieldErrors(e);
      Object.keys(fe).length ? setErrors(fe) : toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!target} title="Schedule meeting" subtitle={target?.name} icon={CalendarPlus} tone="indigo" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <DatePicker label="Date" required min={todayIso()} value={when.slice(0, 10)} onChange={(d) => { setWhen(`${d}T${when.slice(11, 16) || "11:00"}`); setErrors({}); }} error={errors.startsAt && !when.slice(0, 10) ? errors.startsAt : undefined} />
          <TimePicker label="Time" required value={when.slice(11, 16)} onChange={(t) => { setWhen(`${when.slice(0, 10) || todayIso(1)}T${t}`); setErrors({}); }} error={errors.startsAt && !when.slice(11, 16) ? "Pick the time" : undefined} />
        </div>
        <SelectField
          label="Type"
          required
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          options={[{ value: "physical", label: "Physical" }, { value: "online", label: "Online" }]}
        />
        <InputField
          label={kind === "physical" ? "Location (optional)" : "Meeting link (optional)"}
          value={place}
          onChange={(e) => setPlace(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} className="h-4 w-4 accent-violet-600" />
          Remind the client on WhatsApp
        </label>
        <Button onClick={save} loading={busy} className="w-full">Schedule</Button>
      </div>
    </Sheet>
  );
}
