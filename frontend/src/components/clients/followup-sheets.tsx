"use client";
import { CalendarClock, PhoneCall } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { Sheet } from "@/components/ui/sheet";
import { fieldErrors } from "@/lib/api-errors";
import { nextBusinessDayIso, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { DateChips } from "../crm/date-chips";
import { VoiceTextarea } from "../crm/voice-textarea";

/** taskId: finish that follow-up. Without one (a call from the client page or list), the call is recorded and it
 * finishes the client's open call if there is one. calling: shown while the number is being dialled. */
export type ClientTaskTarget = { taskId?: string; companyId: string; companyName: string; title?: string | null; calling?: string };

const OUTCOMES = [
  // The same words as a lead's call outcome, so a client call and a deal call read alike.
  { key: "no_answer", label: "Not reachable", hint: "Try again on a date" },
  { key: "interested", label: "Interested", hint: "Create a project now" },
  { key: "not_now", label: "Not interested", hint: "Nothing needed this time" },
  { key: "done", label: "Check-in done", hint: "Spoke to them, nothing to sell" },
] as const;

/** "Diwali on 29 Oct: ask about gifting" -> "Diwali gifting 2027" as a starting project name. */
function projectNameFrom(title?: string | null): string {
  const occasion = (title ?? "").split(/ on |:/)[0].trim();
  return occasion ? `${occasion} gifting ${new Date().getFullYear() + (new Date().getMonth() >= 10 ? 1 : 0)}` : "";
}

/** Finish a client follow-up (an occasion call or a check-in). "Interested" turns into a project in the same step. */
export function ClientFollowUpSheet({ target, onClose, onDone }: { target: ClientTaskTarget | null; onClose: () => void; onDone: (projectId?: string | null) => void }) {
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]["key"] | "">("");
  const [project, setProject] = useState("");
  const [note, setNote] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) setProject(projectNameFrom(target.title));
    else { setOutcome(""); setNote(""); setNext(""); setErrors({}); }
  }, [target]);

  async function save() {
    if (!target) return;
    const e: Record<string, string> = {};
    if (!outcome) e.outcome = "Select what happened";
    if (outcome === "interested" && !project.trim()) e.projectTitle = "Name the project";
    if (outcome === "no_answer" && !next) e.nextFollowUp = "Pick when to try again";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const url = target.taskId ? `/clients/${target.companyId}/followups/${target.taskId}/complete` : `/clients/${target.companyId}/calls`;
      const res = await apiClient.post<{ projectId?: string | null }>(url, {
        outcome, note: note.trim() || null, nextFollowUp: next || null, projectTitle: outcome === "interested" ? project.trim() : null,
      });
      toast.success(outcome === "interested" ? "Project created" : "Saved");
      onClose();
      onDone(res.data.projectId);
    } catch (err) {
      const fe = fieldErrors(err);
      Object.keys(fe).length ? setErrors(fe) : toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!target} title="Log outcome" subtitle={target ? `${target.companyName}${target.title ? ` · ${target.title}` : ""}` : undefined} icon={PhoneCall} tone="emerald" onClose={onClose}>
      <div className="space-y-4">
        {target?.calling && (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <PhoneCall className="h-4 w-4 shrink-0 animate-pulse" aria-hidden="true" />
            <span>Calling <b className="font-semibold">{target.calling}</b>… When the call ends, pick what happened.</span>
          </p>
        )}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">What happened?<span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span></span>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map((o) => (
              <button key={o.key} type="button" onClick={() => { setOutcome(o.key); setErrors({}); if (o.key === "no_answer" && !next) setNext(nextBusinessDayIso()); }}
                className={cn("pressable rounded-xl border px-3 py-2.5 text-left", outcome === o.key ? "border-brand bg-brand-soft" : "border-slate-300 hover:bg-slate-50")}>
                <span className={cn("block text-sm font-medium", outcome === o.key ? "text-brand" : "text-slate-800")}>{o.label}</span>
                <span className="block text-xs text-slate-500">{o.hint}</span>
              </button>
            ))}
          </div>
          {errors.outcome && <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{errors.outcome}</p>}
        </div>
        {outcome === "interested" && (
          <InputField label="Project" required value={project} onChange={(e) => { setProject(e.target.value); setErrors((x) => ({ ...x, projectTitle: "" })); }} error={errors.projectTitle} />
        )}
        {(outcome === "no_answer" || outcome === "not_now" || outcome === "done") && (
          <DateChips label={outcome === "no_answer" ? "Try again on" : "Next check-in (optional)"} required={outcome === "no_answer"} value={next} onChange={(d) => { setNext(d); setErrors((x) => ({ ...x, nextFollowUp: "" })); }} error={errors.nextFollowUp} />
        )}
        <VoiceTextarea label="Note (optional)" value={note} onChange={setNote} rows={2} />
        <Button onClick={save} loading={busy} className="w-full">Save</Button>
      </div>
    </Sheet>
  );
}

/** Plan a check-in with a client (not tied to a project). */
export function ScheduleClientSheet({ client, onClose, onDone }: { client: { id: string; name: string } | null; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(nextBusinessDayIso());
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!client) { setDate(nextBusinessDayIso()); setTitle(""); setErr(undefined); } }, [client]);

  async function save() {
    if (!client) return;
    if (!date) return setErr("Pick the date");
    setBusy(true);
    try {
      await apiClient.post(`/clients/${client.id}/followups`, { dueDate: date, title: title.trim() || null });
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
    <Sheet open={!!client} title="Client follow-up" subtitle={client?.name} icon={CalendarClock} tone="amber" onClose={onClose}>
      <div className="space-y-4">
        <InputField label="What about (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter a short reason" />
        <DateChips label="Follow up on" required value={date} onChange={(d) => { setDate(d); setErr(undefined); }} error={err} />
        <p className="text-xs text-slate-400">It appears on the Today screen of the client's owner on {date || todayIso()}.</p>
        <Button onClick={save} loading={busy} className="w-full">Schedule</Button>
      </div>
    </Sheet>
  );
}
