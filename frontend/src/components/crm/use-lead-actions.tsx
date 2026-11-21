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
import { PaymentRequestSheet } from "./payment-request-sheet";
import { QuickLogSheet } from "./quick-log-sheet";
import { QuotationSheet } from "./quotation-sheet";
import { ReassignSheet } from "./reassign-sheet";
import { ScheduleSheet } from "./schedule-sheet";
import { SendQuotationSheet } from "./send-quotation-sheet";
import { StageSheet } from "./stage-sheet";
import type { LeadTarget } from "./types";
import { WhatsAppSheet } from "./whatsapp-sheet";

/**
 * One place that owns every action sheet (call, WhatsApp, meeting, minutes, quotation, agreement, payment, stage,
 * reassign, complete). Screens call `actions.call(target)` etc. and render `actions.sheets` once, so the same
 * actions work from the lead card, the pipeline board and the Today screen.
 */
export function useLeadActions(onChange: () => void, ownerId?: string | null) {
  const meta = useApi<LeadMeta>("/leads/meta");
  const [closing, setClosing] = useState<LeadTarget | null>(null);
  const [call, setCall] = useState<LeadTarget | null>(null);
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
  const [payment, setPayment] = useState<{ target: LeadTarget; amount?: number | null } | null>(null);

  const startCall = useCallback((t: LeadTarget) => {
    // Dial first; the outcome sheet is waiting when the executive comes back from the call.
    const href = telHref(t.phone);
    if (href) window.location.href = href;
    setCall(t);
  }, []);

  /**
   * Moving a lead forward is done by doing the work that stage stands for, so those stages open the matching
   * dialog (meeting, minutes, quotation, signed agreement) instead of a bare "move" form.
   */
  const moveTo = useCallback((t: LeadTarget, to: StageKey) => {
    if (to === "meeting_scheduled" || to === "project_meeting") setMeeting(t);
    else if (to === "requirement_received") setMinutes(t);
    else if (to === "quotation_sent" || to === "project_proposal") setQuotation(t);
    else if (to === "agreement_payment") setAgreement(t);
    else setStage({ target: t, stage: to });
  }, []);

  const sheets: ReactNode = (
    <>
      <QuickLogSheet target={call} onClose={() => setCall(null)} onDone={onChange} onMarkLost={(t) => setStage({ target: t, stage: "closed_lost" })} />
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
    agreement: setAgreement, payment: (target: LeadTarget, amount?: number | null) => setPayment({ target, amount }), sheets,
  };
}
