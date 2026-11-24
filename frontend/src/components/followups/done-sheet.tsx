"use client";
import { ArrowLeftRight, CalendarClock, CheckCircle2, ChevronLeft, Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DateChips } from "@/components/crm/date-chips";
import { VoiceTextarea } from "@/components/crm/voice-textarea";
import { StageIcon } from "@/components/lead/stage-icon";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { fieldErrors } from "@/lib/api-errors";
import { nextBusinessDayIso, PIPELINE_STAGES, STAGE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { FollowUpItem, StageKey } from "@/types/crm";

type Props = {
  item: FollowUpItem | null;
  onClose: () => void;
  onDone: () => void;
  /** Opens the stage's own dialog (meeting, minutes, quotation, lost reason...). That dialog sets the next date. */
  onMoveStage: (item: FollowUpItem, stage: StageKey) => void;
};

/**
 * "Follow-up done": the follow-up is finished, so say what comes next. Either a new follow-up date, or the deal moves
 * to another stage (whose dialog asks for its own next date). Nothing is left without a next step.
 */
export function FollowUpDoneSheet({ item, onClose, onDone, onMoveStage }: Props) {
  const [mode, setMode] = useState<"choose" | "date" | "stage">("choose");
  const [date, setDate] = useState(nextBusinessDayIso());
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string>();
  const [noteErr, setNoteErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (item) { setMode("choose"); setDate(nextBusinessDayIso()); setNote(""); setErr(undefined); setNoteErr(undefined); }
  }, [item]);

  const name = item ? (item.projectTitle ? `${item.companyName} · ${item.projectTitle}` : item.companyName) : "";
  const steps = item ? (PIPELINE_STAGES[item.pipeline ?? "new_business"] as readonly StageKey[]) : [];

  // A meeting follow-up is done when the meeting is: mark it done first, so it leaves the calendar.
  const finishMeeting = async () => {
    if (item?.meeting) await apiClient.patch(`/meetings/${item.meeting.id}`, { status: "done" });
  };

  async function saveDate() {
    if (!item) return;
    if (!note.trim()) return setNoteErr("Say what happened");
    if (!date) return setErr("Pick the next follow-up date");
    setBusy(true);
    try {
      if (item.meeting && item.leadId) {
        await finishMeeting();
        await apiClient.post("/tasks", { leadId: item.leadId, dueDate: date, title: note.trim().slice(0, 200) || null });
        if (note.trim()) await apiClient.post(`/leads/${item.leadId}/notes`, { note: note.trim() });
      } else {
        await apiClient.post(`/tasks/${item.id}/complete`, { nextFollowUp: date, outcome: note.trim() });
      }
      toast.success("Follow-up done");
      onClose();
      onDone();
    } catch (e) {
      const f = fieldErrors(e).nextFollowUp;
      setErr(f);
      if (!f) toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickStage(stage: StageKey) {
    if (!item) return;
    setBusy(true);
    try {
      await finishMeeting();
      const it = item;
      onClose();
      onMoveStage(it, stage);
      if (it.meeting) onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const option = "pressable flex w-full items-center gap-4 rounded-2xl border p-4 text-left";
  return (
    <Sheet open={!!item} title="Follow-up done" subtitle={name} icon={CheckCircle2} tone="emerald" onClose={onClose}>
      {mode === "choose" && (
        <div className="space-y-3">
          <p className="t-body text-slate-500">What happens next?</p>
          <button type="button" onClick={() => setMode("date")} className={cn(option, "border-slate-200 hover:border-brand hover:bg-brand-soft/40")}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-brand"><CalendarClock className="h-5 w-5" /></span>
            <span className="min-w-0"><span className="t-body block font-semibold text-slate-900">Set the next follow-up</span><span className="t-meta block">Same stage, talk again on a new date</span></span>
          </button>
          <button type="button" onClick={() => setMode("stage")} className={cn(option, "border-slate-200 hover:border-brand hover:bg-brand-soft/40")}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600"><ArrowLeftRight className="h-5 w-5" /></span>
            <span className="min-w-0"><span className="t-body block font-semibold text-slate-900">Move to another stage</span><span className="t-meta block">The deal moved on, or it is lost</span></span>
          </button>
        </div>
      )}

      {mode === "date" && (
        <div className="space-y-4">
          <Back onClick={() => setMode("choose")} />
          <div>
            <VoiceTextarea label="What happened?" value={note} onChange={(v) => { setNote(v); setNoteErr(undefined); }} rows={2} placeholder="Write the outcome" />
            {noteErr && <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{noteErr}</p>}
          </div>
          <DateChips label="Next follow-up" required value={date} onChange={(d) => { setDate(d); setErr(undefined); }} error={err} />
          <Button onClick={saveDate} loading={busy} className="w-full">Save</Button>
        </div>
      )}

      {mode === "stage" && item && (
        <div className="space-y-2">
          <Back onClick={() => setMode("choose")} />
          {steps.map((s, i) => (
            <button key={s} type="button" disabled={busy || s === item.stage} onClick={() => void pickStage(s)} className={cn("pressable flex w-full items-center gap-3 rounded-2xl border p-3 text-left disabled:cursor-default", s === item.stage ? "border-brand bg-brand-soft" : "border-slate-200 hover:bg-slate-50")}>
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", s === item.stage ? "bg-brand text-white" : "bg-slate-100 text-slate-500")}><StageIcon stage={s} className="h-4 w-4" /></span>
              <span className="t-body flex-1 font-medium text-slate-800">{i + 1}. {STAGE_LABEL[s]}</span>
              {s === item.stage && <span className="t-caption font-semibold text-brand">Current</span>}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => void pickStage("closed_lost")} className="pressable flex w-full items-center gap-3 rounded-2xl border border-dashed border-red-200 p-3 text-left hover:bg-red-50">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600"><Flag className="h-4 w-4" /></span>
            <span className="t-body flex-1 font-medium text-red-700">Close as lost</span>
          </button>
        </div>
      )}
    </Sheet>
  );
}

const Back = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="pressable -ml-1 flex items-center gap-1 rounded-lg px-1 py-0.5 text-sm font-medium text-slate-500 hover:text-slate-800">
    <ChevronLeft className="h-4 w-4" /> Back
  </button>
);
