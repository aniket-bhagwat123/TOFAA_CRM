"use client";
import { useCallback, useState, type ReactNode } from "react";
import { useApi } from "@/hooks/use-api";
import { telHref } from "@/lib/format";
import type { LeadMeta, Quotation, StageKey } from "@/types/crm";
import { AgreementSheet } from "./agreement-sheet";
import { CloseLeadSheet } from "./close-lead-sheet";
import { CompleteSheet } from "./complete-sheet";
import { MeetingSheet } from "./meeting-sheet";
import { MinutesSheet } from "./minutes-sheet";
import { NumberPickerSheet } from "./number-picker-sheet";
import { PaymentRequestSheet } from "./payment-request-sheet";
import { QuickLogSheet } from "./quick-log-sheet";
import { QuotationSheet } from "./quotation-sheet";
import { ReassignSheet } from "./reassign-sheet";
import { SamplingSheet } from "./sampling-sheet";
import { ScheduleSheet } from "./schedule-sheet";
import { SendQuotationSheet } from "./send-quotation-sheet";
import { StageSheet } from "./stage-sheet";
import type { LeadTarget } from "./types";
import { WhatsAppSheet } from "./whatsapp-sheet";

type CallTarget = LeadTarget;

/**
 * One place that owns every action sheet (call, WhatsApp, meeting, minutes, quotation, agreement, payment, stage,
 * reassign, complete). Screens call `actions.call(target)` etc. and render `actions.sheets` once, so the same
 * actions work from the lead card, the pipeline board and the Today screen.
 */
export function useLeadActions(onChange: () => void, ownerId?: string | null) {
  const meta = useApi<LeadMeta>("/leads/meta");
  const [closing, setClosing] = useState<LeadTarget | null>(null);
  const [call, setCall] = useState<CallTarget | null>(null);
  const [pickNumber, setPickNumber] = useState<CallTarget | null>(null);
  const [wa, setWa] = useState<LeadTarget | null>(null);
  const [meeting, setMeeting] = useState<LeadTarget | null>(null);
  const [stage, setStage] = useState<{ target: LeadTarget; stage: StageKey; reopen?: boolean } | null>(null);
  const [reassign, setReassign] = useState<LeadTarget | null>(null);
  const [complete, setComplete] = useState<{ id: string; name: string } | null>(null);
  const [schedule, setSchedule] = useState<LeadTarget | null>(null);
  const [minutes, setMinutes] = useState<LeadTarget | null>(null);
  const [quotation, setQuotation] = useState<LeadTarget | null>(null);
  const [sending, setSending] = useState<{ target: LeadTarget; quotation: Quotation } | null>(null);
  const [agreement, setAgreement] = useState<LeadTarget | null>(null);
  const [sampling, setSampling] = useState<LeadTarget | null>(null);
  const [payment, setPayment] = useState<{ target: LeadTarget; amount?: number | null } | null>(null);

  const dial = useCallback((t: CallTarget, phone?: string | null) => {
    // Dial first; the outcome sheet is waiting when the executive comes back from the call.
    const href = telHref(phone);
    if (href) window.location.href = href;
    const who = (t.name.split(" · ")[1] ?? t.contactName ?? t.name).trim();
    setCall({ ...t, calling: phone ? `${who} · ${phone}` : who });
  }, []);

  // Two numbers on file (after a "Wrong number" call gave a new one): ask which to dial.
  const startCall = useCallback((t: CallTarget) => {
    if (t.phone && t.altPhone) setPickNumber(t);
    else dial(t, t.phone || t.altPhone);
  }, [dial]);

  /**
   * Moving a lead forward is done by doing the work that stage stands for, so those stages open the matching
   * dialog (meeting, minutes, quotation, agreement) instead of a bare "move" form.
   */
  const moveTo = useCallback((t: LeadTarget, to: StageKey) => {
    // A lead becomes Connected by a connected call, so this works like the Call button: it dials (asking which
    // number when there are two), then the call log opens showing the lead's saved status (nothing picked if none).
    // (Only from New Lead: a call never moves a lead back, so moving back from a later stage stays a plain move.)
    if (to === "connected" && t.stage === "new_lead") startCall(t);
    else if (to === "meeting_scheduled" || to === "project_meeting") setMeeting(t);
    else if (to === "requirement_received") setMinutes(t);
    else if (to === "quotation_sent" || to === "project_proposal") setQuotation(t);
    else if (to === "sampling") setSampling(t);
    else if (to === "agreement_payment") setAgreement(t);
    else setStage({ target: t, stage: to });
  }, [startCall]);

  const sheets: ReactNode = (
    <>
      <NumberPickerSheet target={pickNumber} onClose={() => setPickNumber(null)} onPick={(t, phone) => { setPickNumber(null); dial(t, phone); }} />
      <QuickLogSheet target={call} lostReasons={meta.data?.lostReasons ?? []} rules={meta.data?.rules} onClose={() => setCall(null)} onDone={onChange} onMarkLost={(t) => setStage({ target: t, stage: "closed_lost" })} />
      <WhatsAppSheet target={wa} onClose={() => setWa(null)} onDone={onChange} />
      <MeetingSheet target={meeting} onClose={() => setMeeting(null)} onDone={onChange} />
      <MinutesSheet target={minutes} onClose={() => setMinutes(null)} onDone={onChange} />
      <QuotationSheet
        target={quotation}
        onClose={() => setQuotation(null)}
        onDone={onChange}
        onCreated={(q) => quotation && (q.status === "ready" || q.status === "approved") && setSending({ target: quotation, quotation: q })}
      />
      <SendQuotationSheet target={sending?.target ?? null} quotation={sending?.quotation ?? null} onClose={() => setSending(null)} onDone={onChange} />
      <SamplingSheet target={sampling} onClose={() => setSampling(null)} onDone={onChange} />
      <AgreementSheet target={agreement} onClose={() => setAgreement(null)} onDone={onChange} />
      <PaymentRequestSheet target={payment?.target ?? null} suggestedAmount={payment?.amount} onClose={() => setPayment(null)} onDone={onChange} />
      <StageSheet target={stage?.target ?? null} stage={stage?.stage ?? null} reopen={!!stage?.reopen} lostReasons={meta.data?.lostReasons ?? []} onClose={() => setStage(null)} onDone={onChange} />
      <ReassignSheet target={reassign} currentOwnerId={ownerId} onClose={() => setReassign(null)} onDone={onChange} />
      <CloseLeadSheet target={closing} canMarkWon={false} onClose={() => setClosing(null)} onWon={() => undefined} onLost={(t) => setStage({ target: t, stage: "closed_lost" })} />
      <CompleteSheet task={complete} onClose={() => setComplete(null)} onDone={onChange} />
      <ScheduleSheet target={schedule} onClose={() => setSchedule(null)} onDone={onChange} />
    </>
  );

  return {
    /** A lost lead back into the pipeline: a plain move with a next date (no paperwork dialogs; they belong to moving forward). */
    reopen: (t: LeadTarget, to: StageKey) => setStage({ target: t, stage: to, reopen: true }),
    meta: meta.data, call: startCall, logCall: setCall, whatsapp: setWa, meeting: setMeeting, moveTo, reassign: setReassign, close: setClosing,
    complete: setComplete, schedule: setSchedule, minutes: setMinutes, quotation: setQuotation,
    send: (target: LeadTarget, q: Quotation) => setSending({ target, quotation: q }),
    agreement: setAgreement, sampling: setSampling, payment: (target: LeadTarget, amount?: number | null) => setPayment({ target, amount }), sheets,
  };
}
