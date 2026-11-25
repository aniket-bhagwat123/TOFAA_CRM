"use client";
import { CalendarPlus, Phone, UserRoundPen } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { TimePicker } from "@/components/ui/time-picker";
import { istInputToIso, nextBusinessDayIso, OUTCOME_LABEL, todayIso } from "@/lib/format";
import { fieldErrors } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { normalizePhone10, PHONE_MSG } from "@/lib/validation";
import { apiClient, errorMessage } from "@/services/api-client";
import { DateChips } from "./date-chips";
import type { LeadTarget } from "./types";
import { VoiceTextarea } from "./voice-textarea";

export const CALL_OUTCOMES = [
  "not_reachable", "call_back_later", "future_requirement", "interested", "not_interested", "wrong_contact",
] as const;
type Outcome = (typeof CALL_OUTCOMES)[number];
const NEEDS_DATE = new Set<string>(["not_reachable", "call_back_later", "future_requirement"]);
const DEFAULT_MEETING = () => `${todayIso(1)}T11:00`;

/** One line under the buttons: what saving this outcome will do. */
function effect(o: string, attempts: number, newPhone: boolean): string {
  switch (o) {
    case "not_reachable": return `Stays where it is. This will be attempt ${attempts + 1}; pick when to call again.`;
    case "call_back_later": return "Stays where it is. A follow-up is set for the date the client asked for.";
    case "future_requirement": return "No need now, but later: New Lead moves to Connected and is tagged Nurture. Pick when to follow up.";
    case "interested": return "Moves to Connected, then to Meeting Scheduled with the meeting below.";
    case "not_interested": return "The lead is closed as Lost with the reason below.";
    case "wrong_contact": return newPhone ? "The new number becomes the main one; the lead stays open." : "The lead is closed as Lost (Invalid contact), unless you add the right contact below.";
    default: return "";
  }
}

type Props = {
  target: LeadTarget | null;
  lostReasons?: string[];
  rules?: { retry: { maxAttempts: number; gapDays: number }; nurtureDays: number } | null; // Settings > Rules: default dates
  onClose: () => void;
  onDone: () => void;
  onMarkLost?: (t: LeadTarget) => void; // kept for callers; closing is now part of the outcome
};

/** After a call: what happened, and what that means for the lead. Built to finish in under 20 seconds. */
export function QuickLogSheet({ target, lostReasons = [], rules, onClose, onDone }: Props) {
  const [outcome, setOutcome] = useState<string>("");
  const [note, setNote] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [date, setDate] = useState(nextBusinessDayIso());
  const [time, setTime] = useState(""); // optional: when the client asked to be called back
  const [when, setWhen] = useState(DEFAULT_MEETING());
  const [kind, setKind] = useState("physical");
  const [place, setPlace] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Only the status saved on the lead is picked; with none saved, nothing is picked and the user chooses.
  useEffect(() => {
    if (!target) return;
    const saved = (CALL_OUTCOMES as readonly string[]).includes(target.lastCallOutcome ?? "") ? target.lastCallOutcome! : "";
    pick(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  /** The suggested next date for an outcome: the retry gap after "Not reachable", the Nurture days after "Future requirement". */
  function defaultDate(o: string): string {
    if (o === "not_reachable" && rules?.retry.gapDays) return todayIso(rules.retry.gapDays);
    if (o === "future_requirement" && rules?.nurtureDays) return todayIso(rules.nurtureDays);
    return nextBusinessDayIso();
  }

  function pick(o: string) {
    setOutcome(o);
    setErrors({});
    if (NEEDS_DATE.has(o)) setDate(defaultDate(o));
  }

  function close() {
    setOutcome(""); setNote(""); setNewPhone(""); setNewName(""); setDate(nextBusinessDayIso()); setTime("");
    setWhen(DEFAULT_MEETING()); setKind("physical"); setPlace(""); setReason(""); setErrors({});
    onClose();
  }

  const swapping = outcome === "wrong_contact" && !!newPhone.trim();
  const showDate = NEEDS_DATE.has(outcome) || swapping;
  const attempts = target?.callAttempts ?? 0;

  async function save() {
    if (!target) return;
    const e: Record<string, string> = {};
    if (!outcome) e.outcome = "Select what happened on the call";
    if (NEEDS_DATE.has(outcome) && !date) e.nextFollowUp = "Pick the next follow-up date";
    if (outcome === "interested" && (!when.slice(0, 10) || !when.slice(11, 16))) e.meeting = "Pick the meeting date and time";
    if (outcome === "not_interested" && !reason) e.lostReason = "Pick a reason";
    if (outcome === "wrong_contact" && newName.trim() && !newPhone.trim()) e.newPhone = "Enter the new number for this person";
    else if (swapping && !normalizePhone10(newPhone)) e.newPhone = PHONE_MSG;
    else if (swapping && normalizePhone10(newPhone) === normalizePhone10(target.phone)) e.newPhone = "This is the current number";
    if (Object.keys(e).length) return setErrors(e);

    setBusy(true);
    try {
      const res = await apiClient.post<{ closed: boolean; stage: string; statusSaved?: boolean; attempts?: number | null; phone?: string | null; name?: string | null }>(`/leads/${target.leadId}/calls`, {
        outcome,
        note: note.trim() || null,
        nextFollowUp: showDate && date ? date : null,
        nextFollowUpTime: showDate && date && time ? time : null, // empty: the app uses 10:00 AM
        taskId: target.taskId ?? null,
        newPhone: swapping ? normalizePhone10(newPhone) : null,
        newName: swapping ? newName.trim() || null : null,
        lostReason: outcome === "not_interested" ? reason : null,
        meeting: outcome === "interested"
          ? { startsAt: istInputToIso(when), kind, location: kind === "physical" ? place || null : null, link: kind === "online" ? place || null : null }
          : null,
      });
      const d = res.data;
      toast.success(
        d.closed ? "Call logged. The lead is closed as Lost."
          : outcome === "interested" ? "Call logged. Meeting scheduled."
          : d.phone ? `Call logged. ${d.name ? `${d.name} (${d.phone})` : d.phone} is now the main contact; the old number is kept as the second one.`
          : outcome === "not_reachable" && d.attempts ? `Call logged. Attempt ${d.attempts}.`
          : "Call logged",
      );
      if (d.statusSaved === false) {
        toast.warning("The call is in the history, but the lead's call status and attempts could not be updated: the database needs the latest migration (20260112000000_call_outcomes_v2.sql). Ask an admin to run it.", { duration: 10000 });
      }
      close();
      onDone();
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const saveLabel =
    outcome === "not_interested" || (outcome === "wrong_contact" && !swapping) ? "Save and close as lost"
      : outcome === "interested" ? "Save and schedule meeting"
      : "Save";

  return (
    <Sheet open={!!target} title="Log outcome" subtitle={target?.name} icon={Phone} tone="emerald" onClose={close}>
      <div className="space-y-4">
        {target?.calling && (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <Phone className="h-4 w-4 shrink-0 animate-pulse" aria-hidden="true" />
            <span>Calling <b className="font-semibold">{target.calling}</b>… When the call ends, pick what happened.</span>
          </p>
        )}
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">What happened?<span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span></span>
          <div className="grid grid-cols-2 gap-2">
            {CALL_OUTCOMES.map((o: Outcome) => (
              <button
                key={o}
                type="button"
                onClick={() => pick(o)}
                aria-pressed={outcome === o}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-sm font-medium",
                  outcome === o ? "border-brand bg-brand-soft text-brand" : "border-slate-300 text-slate-700 hover:bg-slate-50",
                )}
              >
                {OUTCOME_LABEL[o]}
              </button>
            ))}
          </div>
          {errors.outcome && <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{errors.outcome}</p>}
          {outcome && <p className="mt-2 text-xs text-slate-500">{effect(outcome, attempts, swapping)}</p>}
        </div>

        {outcome === "interested" && (
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5" aria-label="Meeting">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarPlus className="h-4 w-4 text-brand" aria-hidden="true" /> Meeting</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <DatePicker label="Date" required min={todayIso()} value={when.slice(0, 10)} onChange={(d) => { setWhen(`${d}T${when.slice(11, 16) || "11:00"}`); setErrors((x) => ({ ...x, meeting: "" })); }} error={errors.meeting && !when.slice(0, 10) ? errors.meeting : undefined} />
              <TimePicker label="Time" required value={when.slice(11, 16)} onChange={(t) => { setWhen(`${when.slice(0, 10) || todayIso(1)}T${t}`); setErrors((x) => ({ ...x, meeting: "" })); }} error={errors.meeting && when.slice(0, 10) ? errors.meeting : undefined} />
              <SelectField label="Type" required value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: "physical", label: "Physical" }, { value: "online", label: "Online" }]} />
              <InputField label={kind === "physical" ? "Location (optional)" : "Meeting link (optional)"} value={place} onChange={(e) => setPlace(e.target.value)} />
            </div>
          </section>
        )}

        {outcome === "not_interested" && (
          <SelectField
            label="Reason"
            required
            placeholder="Select"
            value={reason}
            onChange={(e) => { setReason(e.target.value); setErrors((x) => ({ ...x, lostReason: "" })); }}
            options={lostReasons.filter((r) => r !== "Invalid contact").map((r) => ({ value: r, label: r }))}
            error={errors.lostReason}
          />
        )}

        {outcome === "wrong_contact" && (
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5" aria-label="New contact details">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <UserRoundPen className="h-4 w-4 text-brand" aria-hidden="true" /> New contact details <span className="font-normal text-slate-400">(optional)</span>
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {target?.phone ? `The new number becomes the main one. ${target.phone} is kept as the second number, so you can call either.` : "The new number becomes the main one."}
                {" "}Leave empty to close the lead as Invalid contact.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <InputField
                label="New contact number"
                placeholder="Enter contact number"
                type="tel"
                value={newPhone}
                onChange={(e) => { setNewPhone(e.target.value); setErrors((x) => ({ ...x, newPhone: "" })); }}
                error={errors.newPhone}
              />
              <InputField
                label="Full name"
                value={newName}
                maxLength={120}
                onChange={(e) => { setNewName(e.target.value); setErrors((x) => ({ ...x, newName: "", newPhone: x.newPhone === "Enter the new number for this person" ? "" : x.newPhone ?? "" })); }}
                error={errors.newName}
              />
            </div>
          </section>
        )}

        {showDate && (
          <DateChips
            label={outcome === "not_reachable" ? "Call again on" : "Next follow-up"}
            required={NEEDS_DATE.has(outcome)}
            value={date}
            onChange={(d) => { setDate(d); setErrors((x) => ({ ...x, nextFollowUp: "" })); }}
            error={errors.nextFollowUp}
          />
        )}
        {showDate && (
          <TimePicker label={outcome === "call_back_later" ? "Call back at" : outcome === "not_reachable" ? "Call again at" : "Time"} value={time} onChange={setTime} placeholder="10:00 AM (default)" />
        )}
        <VoiceTextarea label="Note (optional)" value={note} onChange={setNote} rows={2} placeholder="Write a note" />
        <Button onClick={save} loading={busy} variant={saveLabel === "Save and close as lost" ? "danger" : "primary"} className="w-full">{saveLabel}</Button>
      </div>
    </Sheet>
  );
}
