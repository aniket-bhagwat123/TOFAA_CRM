"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { ArrowRight, ArrowRightLeft, RotateCcw, ThumbsDown, Trophy } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { StageBadge } from "@/components/ui/stage-badge";
import { fieldErrors } from "@/lib/api-errors";
import { nextBusinessDayIso, STAGE_LABEL, todayIso } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import type { StageKey } from "@/types/crm";
import { DateChips } from "./date-chips";
import type { LeadTarget } from "./types";

const FIELD_LABEL: Record<string, { label: string; type?: string; integer?: boolean }> = {
  occasion: { label: "Occasion" },
  quantity: { label: "Quantity", type: "number", integer: true },
  budget: { label: "Budget (₹)", type: "number" },
  deliveryDate: { label: "Delivery date", type: "date" },
  quotationTotal: { label: "Quotation total (₹)", type: "number" },
};
const REQUIRED: Record<string, string[]> = {
  requirement_received: ["occasion", "quantity", "budget", "deliveryDate"],
};

type Props = {
  target: LeadTarget | null;
  stage: StageKey | null; // where the lead is going
  lostReasons: string[];
  reopen?: boolean; // bringing a lost lead back: details saved earlier are reused, so nothing is retyped
  onClose: () => void;
  onDone: () => void;
};

/** Any stage change asks for the next follow-up date and the few inputs that stage needs. */
export function StageSheet({ target, stage, lostReasons, reopen, onClose, onDone }: Props) {
  const [date, setDate] = useState(nextBusinessDayIso());
  const [reason, setReason] = useState("");
  const [req, setReq] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const lost = stage === "closed_lost";
  const closed = lost || stage === "closed_won";
  // On a reopen the server reuses the saved requirement; a field shows only if it turns out to be missing.
  const fields = (stage ? REQUIRED[stage] ?? [] : []).filter((f) => !reopen || errors[f]);

  async function save() {
    if (!target || !stage) return;
    const problems: Record<string, string> = {};
    if (lost && !reason) problems.lostReason = "Pick a reason";
    for (const f of fields) {
      const raw = (req[f] ?? "").toString().trim();
      const name = FIELD_LABEL[f].label.replace(" (₹)", "");
      if (!raw) problems[f] = `${name} is required`;
      else if (FIELD_LABEL[f].type === "number" && !(Number(raw) > 0)) problems[f] = `${name} must be greater than 0`;
    }
    if (!closed && !date) problems.nextFollowUp = "Pick the next follow-up date";
    if (Object.keys(problems).length) return setErrors(problems);
    setBusy(true);
    try {
      const requirement = Object.fromEntries(
        Object.entries(req).filter(([, v]) => v !== "").map(([k, v]) => [k, FIELD_LABEL[k]?.type === "number" ? Number(v) : v]),
      );
      await apiClient.post(`/leads/${target.leadId}/stage`, {
        stage,
        nextFollowUp: closed ? null : date || null,
        lostReason: lost ? reason || null : null,
        requirement,
      });
      toast.success(reopen ? `Reopened at ${STAGE_LABEL[stage]}` : `Moved to ${STAGE_LABEL[stage]}`);
      setErrors({}); setReq({}); setReason("");
      onClose();
      onDone();
    } catch (e) {
      const fe = fieldErrors(e);
      if (Object.keys(fe).length) setErrors(fe);
      else toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!target && !!stage} title={reopen && stage ? `Reopen at ${STAGE_LABEL[stage]}` : stage === "closed_lost" ? "Mark as lost" : stage === "closed_won" ? "Mark as won" : stage ? `Move to ${STAGE_LABEL[stage]}` : ""} subtitle={target?.name} icon={reopen ? RotateCcw : stage === "closed_lost" ? ThumbsDown : stage === "closed_won" ? Trophy : ArrowRightLeft} tone={stage === "closed_lost" ? "red" : stage === "closed_won" ? "emerald" : "violet"} onClose={onClose}>
      <div className="space-y-4">
        {target && stage && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm">
            <span className="flex items-center gap-1.5 text-slate-500">
              <StageBadge stage={target.stage} /> <ArrowRight className="h-4 w-4" /> <StageBadge stage={stage} />
            </span>
          </div>
        )}
        {errors.stage && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errors.stage}</p>}
        {errors.meeting && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{errors.meeting}</p>}
        {lost && (
          <SelectField
            label="Why was it lost?"
            required
            value={reason}
            placeholder="Choose a reason"
            options={lostReasons.map((r) => ({ value: r, label: r }))}
            onChange={(e) => { setReason(e.target.value); setErrors((x) => ({ ...x, lostReason: "" })); }}
            error={errors.lostReason}
          />
        )}
        {fields.map((f) => FIELD_LABEL[f].type === "date" ? (
          <DatePicker key={f} label={FIELD_LABEL[f].label} required min={todayIso()} value={req[f] ?? ""} onChange={(d) => { setReq((r) => ({ ...r, [f]: d })); setErrors((x) => ({ ...x, [f]: "" })); }} error={errors[f]} />
        ) : (
          <InputField
            key={f}
            label={FIELD_LABEL[f].label}
            type={FIELD_LABEL[f].type ?? "text"}
            integer={FIELD_LABEL[f].integer}
            required
            value={req[f] ?? ""}
            onChange={(e) => { setReq((r) => ({ ...r, [f]: e.target.value })); setErrors((x) => ({ ...x, [f]: "" })); }}
            error={errors[f]}
          />
        ))}
        {!closed && <DateChips label="Next follow-up" required value={date} onChange={(d) => { setDate(d); setErrors((x) => ({ ...x, nextFollowUp: "" })); }} error={errors.nextFollowUp} />}
        <Button onClick={save} loading={busy} variant={lost ? "danger" : "primary"} className="w-full">
          {lost ? "Mark as lost" : stage === "closed_won" ? "Mark as won" : reopen ? "Reopen lead" : "Move lead"}
        </Button>
      </div>
    </Sheet>
  );
}
