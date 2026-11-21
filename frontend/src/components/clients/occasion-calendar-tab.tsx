"use client";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField } from "@/components/ui/input-field";
import { useApi } from "@/hooks/use-api";
import { formatDate, todayIso } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import type { CalendarDate } from "@/types/crm";

/** Festival dates move every year, so Admin keeps them here. Client occasion reminders read their dates from this list. */
export function OccasionCalendarTab() {
  const list = useApi<CalendarDate[]>("/occasion-calendar");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function add() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Festival name is required";
    if (!date) e.date = "Pick the date";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await apiClient.post("/occasion-calendar", { name: name.trim(), occursOn: date });
      toast.success("Date added");
      setName(""); setDate("");
      void list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await apiClient.delete(`/occasion-calendar/${id}`);
      void list.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const upcoming = (list.data ?? []).filter((c) => c.occursOn >= todayIso());
  return (
    <Card className="space-y-4">
      <p className="text-sm text-slate-500">Festival dates for the coming years. Please check the dates of movable festivals (Diwali, Holi, Raksha Bandhan) each year: reminders to call clients are based on them.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <InputField label="Festival" required value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: "" })); }} error={errors.name} />
        <DatePicker label="Date" required min={todayIso()} value={date} onChange={(d) => { setDate(d); setErrors((x) => ({ ...x, date: "" })); }} error={errors.date} />
        <Button onClick={add} loading={busy}>Add</Button>
      </div>
      <div className="divide-y divide-slate-100">
        {upcoming.map((c) => (
          <div key={c.id} className="flex items-center justify-between py-2.5 text-sm">
            <span className="font-medium">{c.name}</span>
            <span className="flex items-center gap-3 text-slate-500">{formatDate(c.occursOn)} {c.occursOn.slice(0, 4)}
              <button type="button" onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`} className="pressable rounded-full p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
