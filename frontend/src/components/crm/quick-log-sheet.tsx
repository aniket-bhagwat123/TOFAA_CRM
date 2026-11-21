"use client";
import { Phone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { nextBusinessDayIso, OUTCOME_LABEL } from "@/lib/format";
import { fieldErrors } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { DateChips } from "./date-chips";
import type { LeadTarget } from "./types";
import { VoiceTextarea } from "./voice-textarea";

const OUTCOMES = ["connected", "no_answer", "call_back_later", "not_interested", "wrong_number"] as const;
const DATE_OPTIONAL = new Set(["not_interested", "wrong_number"]);

type Props = { target: LeadTarget | null; onClose: () => void; onDone: () => void; onMarkLost: (t: LeadTarget) => void };

/** After a call: outcome, optional note, next follow-up date. Built to finish in under 20 seconds. */
export function QuickLogSheet({ target, onClose, onDone, onMarkLost }: Props) {
  const [outcome, setOutcome] = useState<string>("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(nextBusinessDayIso());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function close() {
    setOutcome(""); setNote(""); setDate(nextBusinessDayIso()); setErrors({});
    onClose();
  }

  async function save() {
    if (!target) return;
    const problems: Record<string, string> = {};
    if (!outcome) problems.outcome = "Select what happened on the call";
    if (outcome && !DATE_OPTIONAL.has(outcome) && !date) problems.nextFollowUp = "Pick the next follow-up date";
    if (Object.keys(problems).length) return setErrors(problems);
    setBusy(true);
    try {
      const res = await apiClient.post<{ suggestMarkLost: boolean }>(`/leads/${target.leadId}/calls`, {
        outcome,
        note: note.trim() || null,
        nextFollowUp: date || null,
      });
      toast.success("Call logged");
      const t = target;
      close();
      onDone();
      if (res.data.suggestMarkLost) {
        toast("Close this lead?", { action: { label: "Mark lost", onClick: () => onMarkLost(t) }, duration: 8000 });
      }
    } catch (e) {
      const fe = fieldErrors(e);
      if (Object.keys(fe).length) setErrors(fe);
      else toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!target} title="Call outcome" subtitle={target?.name} icon={Phone} tone="emerald" onClose={close}>
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">What happened?<span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span></span>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => { setOutcome(o); setErrors({}); if (DATE_OPTIONAL.has(o)) setDate(""); else if (!date) setDate(nextBusinessDayIso()); }}
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
        </div>
        <DateChips
          label="Next follow-up"
          required={!DATE_OPTIONAL.has(outcome)}
          value={date}
          onChange={setDate}
          error={errors.nextFollowUp}
        />
        <VoiceTextarea label="Note (optional)" value={note} onChange={setNote} rows={2} placeholder="Write a note" />
        <Button onClick={save} loading={busy} className="w-full">Save</Button>
      </div>
    </Sheet>
  );
}
