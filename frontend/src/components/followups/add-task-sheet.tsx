"use client";
import { Check, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { VoiceTextarea } from "@/components/crm/voice-textarea";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { StageBadge } from "@/components/ui/stage-badge";
import { TimePicker } from "@/components/ui/time-picker";
import { useApi } from "@/hooks/use-api";
import { fieldErrors } from "@/lib/api-errors";
import { istInputToIso, nextBusinessDayIso, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { Lead } from "@/types/crm";

const TYPES = [
  { value: "call", label: "Call" },
  { value: "follow_up", label: "Follow-up" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "other", label: "Other task" },
];
const CLOSED = new Set(["closed_won", "closed_lost"]);
const leadName = (l: Lead) => (l.projectTitle && l.pipeline === "client" ? `${l.company.name} · ${l.projectTitle}` : l.company.name);

type Props = { open: boolean; onClose: () => void; onDone: () => void };

/** The "+" button: a new follow-up. Lead, task type, date and time are required; the note is optional. */
export function AddTaskSheet({ open, onClose, onDone }: Props) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [lead, setLead] = useState<Lead | null>(null);
  const [kind, setKind] = useState("call");
  const [date, setDate] = useState(nextBusinessDayIso());
  const [time, setTime] = useState("11:00");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setQuery(""); setSearch(""); setLead(null); setKind("call"); setDate(nextBusinessDayIso()); setTime("11:00"); setNote(""); setErrors({}); }
  }, [open]);
  useEffect(() => { const t = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  const searching = open && !lead && search.length >= 2;
  const leads = useApi<{ items: Lead[] }>(searching ? "/leads" : null, { search, limit: 8 });
  const projects = useApi<{ items: Lead[] }>(searching ? "/leads" : null, { search, limit: 5, pipeline: "client" });
  const results = [...(leads.data?.items ?? []), ...(projects.data?.items ?? [])].filter((l) => !CLOSED.has(l.stage));
  const loading = searching && (leads.loading || projects.loading);

  async function save() {
    const e: Record<string, string> = {};
    if (!lead) e.lead = "Pick the lead";
    if (!kind) e.kind = "Pick the task type";
    if (!date) e.dueDate = "Pick a date";
    if (!time) e.time = "Pick a time";
    const dueAt = date && time ? istInputToIso(`${date}T${time}`) : null;
    if (dueAt && Date.parse(dueAt) < Date.now()) e.time = "Pick a time later than now";
    if (Object.keys(e).length || !lead) return setErrors(e);

    setBusy(true);
    try {
      await apiClient.post("/tasks", { leadId: lead.id, kind, dueDate: date, dueAt, title: note.trim().slice(0, 200) || null });
      toast.success("Task added. It replaces the lead's earlier open follow-up.");
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
    <Sheet open={open} title="Add task" icon={Plus} tone="violet" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Lead<span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span></span>
          {lead ? (
            <div className="flex items-center gap-3 rounded-xl border border-brand bg-brand-soft/50 p-3">
              <Check className="h-4 w-4 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900">{leadName(lead)}</div>
                <div className="truncate text-xs text-slate-500">{lead.contact.name}{lead.contact.phone ? ` · ${lead.contact.phone}` : ""}</div>
              </div>
              <button type="button" aria-label="Change lead" onClick={() => setLead(null)} className="pressable rounded-lg p-1 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="space-y-2">
              <SearchInput value={query} onChange={setQuery} placeholder="Search company, contact or phone" className="sm:w-full" />
              {loading && <div className="flex justify-center py-3"><Spinner /></div>}
              {searching && !loading && results.length === 0 && <p className="px-1 text-xs text-slate-500">No open lead matches “{search}”.</p>}
              {results.length > 0 && (
                <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {results.map((l) => (
                    <li key={l.id}>
                      <button type="button" onClick={() => { setLead(l); setErrors((x) => ({ ...x, lead: "" })); }} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-900">{leadName(l)}</div>
                          <div className="truncate text-xs text-slate-500">{l.contact.name}{l.contact.phone ? ` · ${l.contact.phone}` : ""}</div>
                        </div>
                        <StageBadge stage={l.stage} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {errors.lead && <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{errors.lead}</p>}
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Task type<span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span></span>
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => (
              <button key={t.value} type="button" aria-pressed={kind === t.value} onClick={() => setKind(t.value)}
                className={cn("whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium", kind === t.value ? "border-brand bg-brand-soft text-brand" : "border-slate-300 text-slate-700 hover:bg-slate-50")}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker label="Date" required min={todayIso()} value={date} onChange={(d) => { setDate(d); setErrors((x) => ({ ...x, dueDate: "" })); }} error={errors.dueDate} />
          <TimePicker label="Time" required value={time} onChange={(t) => { setTime(t); setErrors((x) => ({ ...x, time: "" })); }} error={errors.time} />
        </div>
        <VoiceTextarea label="Note (optional)" value={note} onChange={setNote} rows={2} placeholder="What is this task about?" />
        <Button onClick={save} loading={busy} className="w-full">Add task</Button>
      </div>
    </Sheet>
  );
}
