"use client";
/** One gift request, laid out like Gifting OS's request page, in the CRM's colours. */
import { ChevronLeft, Gift } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, type ReactNode } from "react";
import { RequestActions } from "@/components/gifting/request-actions";
import { budgetLabel, codeOf, day, dayTime, GIFT_PURPOSES, GIFT_STYLES, INITIATED_VIA, inr, labelFrom, metaOf, shortDay, StatusChip } from "@/components/gifting/shared";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { GiftRequestDetail, GiftStatus } from "@/types/gifting";

const STEPS: [GiftStatus, string][] = [["SUBMITTED", "Submitted"], ["IN_REVIEW", "In review"], ["PROPOSAL_READY", "Proposal ready"], ["CONFIRMED", "Confirmed"], ["IN_PROGRESS", "In progress"], ["DISPATCHED", "Dispatched"], ["DELIVERED", "Delivered"]];
const APPROVED: GiftStatus[] = ["CONFIRMED", "IN_PROGRESS", "DISPATCHED", "DELIVERED"];
const NEXT: Partial<Record<GiftStatus, { title: string; text: string; tone?: string }>> = {
  SUBMITTED: { title: "Waiting for review", text: "Start the review to begin preparing options." },
  IN_REVIEW: { title: "Preparing options", text: "Share a proposal for the client to choose from." },
  NEEDS_INFO: { title: "Waiting on the client", text: "The client has been asked for more information.", tone: "border-amber-200 bg-amber-50/60" },
  CANCELLED: { title: "This request was cancelled", text: "No further action is needed." },
  CONFIRMED: { title: "Confirmed", text: "The client confirmed an option. Start preparing the gift.", tone: "border-emerald-200 bg-emerald-50/60" },
  IN_PROGRESS: { title: "The gift is being prepared", text: "Mark it dispatched when it is on its way.", tone: "border-violet-200 bg-violet-50/60" },
  DISPATCHED: { title: "The gift is on its way", text: "Mark it delivered when it reaches the recipient.", tone: "border-sky-200 bg-sky-50/60" },
  DELIVERED: { title: "Delivered", text: "The gift reached the recipient.", tone: "border-emerald-200 bg-emerald-50/60" },
};
function eventTitle(to: GiftStatus, from?: GiftStatus | null) {
  switch (to) {
    case "SUBMITTED": return from === "NEEDS_INFO" ? "Resubmitted" : "Submitted";
    case "IN_REVIEW": return "Review started";
    case "PROPOSAL_READY": return "Proposal published";
    case "NEEDS_INFO": return from === "PROPOSAL_READY" ? "Changes requested" : "More information requested";
    case "CONFIRMED": return "Confirmed";
    case "IN_PROGRESS": return "Preparation started";
    case "DISPATCHED": return "Dispatched";
    case "DELIVERED": return "Delivered";
    case "CANCELLED": return "Cancelled";
    default: return "Draft created";
  }
}

export default function GiftRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const router = useRouter();
  const allowed = role === "admin" || role === "sales_manager" || role === "kam";
  useEffect(() => { if (role && !allowed) router.replace("/dashboard"); }, [role, allowed, router]);
  const detail = useApi<GiftRequestDetail>(allowed ? `/gifting-requests/${id}` : null);
  if (!allowed) return null;
  const data = detail.data?.request.id === id ? detail.data : null;
  const back = <Link href="/gifting-requests" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-brand"><ChevronLeft className="h-4 w-4" />Gift requests</Link>;
  if (detail.error && !data) return <><div className="mb-3">{back}</div><StateView kind="error" message={detail.error} onRetry={() => void detail.reload()} /></>;
  if (!data) return <div className="flex justify-center py-20"><Spinner /></div>;

  const r = data.request;
  const history = data.history;
  const reached = new Map<GiftStatus, string>();
  for (const h of history) if (!reached.has(h.toStatus)) reached.set(h.toStatus, h.createdAt);
  const current = r.status === "NEEDS_INFO" ? 1 : STEPS.findIndex(([s]) => s === r.status);
  const stopped = r.status === "CANCELLED";
  const last = Math.max(-1, ...STEPS.map(([s], i) => (reached.has(s) ? i : -1)));
  const options = r.proposal?.options ?? [];
  const approved = APPROVED.includes(r.status);
  const next = NEXT[r.status];

  return (
    <div className="space-y-5">
      <PageHeader title="Gift request" />
      <div>
        {back}
        <div className="mt-2 flex flex-wrap items-center gap-3"><h2 className="text-2xl font-bold text-slate-900">{r.title}</h2><StatusChip status={r.status} /></div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-slate-500"><span className="rounded-full bg-brand-soft px-2.5 py-0.5 font-bold text-brand">{codeOf(r)}</span>Requested by {r.createdByName ?? "—"}{r.createdByRole === "CLIENT" ? " (EA)" : ""} · {day(r.createdAt)} · For {r.recipientName ?? "—"}{r.accountName ? ` · ${r.accountName}` : ""}</p>
      </div>

      <Card className="px-6 py-5">
        <ol className="grid grid-cols-4 gap-3 sm:grid-cols-7">
          {STEPS.map(([status, label], i) => {
            const done = stopped ? i <= last : i <= current;
            const now = !stopped && i === current;
            const date = reached.get(status);
            const waiting = (r.status === "NEEDS_INFO" && status === "IN_REVIEW") || (r.status === "PROPOSAL_READY" && status === "CONFIRMED");
            return (
              <li key={status} aria-current={now ? "step" : undefined}>
                <div className={cn("h-1.5 rounded-full", done ? (stopped ? "bg-slate-400" : "bg-brand") : "bg-slate-200", now && "ring-2 ring-brand/25")} />
                <p className={cn("mt-2 text-xs font-semibold", now ? "text-brand" : "text-slate-800")}>{label}</p>
                <p className="text-xs text-slate-500">{waiting ? "Waiting on client" : date ? shortDay(date) : ""}</p>
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-5">
          {next && <Card className={cn("p-5", next.tone)}><h3 className="text-base font-semibold text-slate-900">{next.title}</h3><p className="mt-1 text-sm text-slate-500">{r.statusNote || next.text}</p></Card>}

          {options.length > 0 && (r.status === "PROPOSAL_READY" || approved) && (
            <Card className="space-y-5 p-6">
              <div><h3 className="text-base font-semibold text-slate-900">Proposal from TOFAA</h3><p className="text-sm text-slate-500">{approved ? "The client confirmed this option." : "Waiting for the client to decide."}</p></div>
              {r.proposal?.note && <blockquote className="rounded-xl bg-slate-50 px-4 py-3 text-sm">“{r.proposal.note}”</blockquote>}
              <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {options.map((o, i) => {
                  const chosen = approved && r.selectedOptionIndex === i;
                  return (
                    <li key={`${o.name}-${i}`} className={cn("rounded-2xl border p-3", chosen ? "border-brand ring-2 ring-brand/30" : "border-slate-200")}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a link kept by Gifting OS */}
                      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-400">{o.imageUrl ? <img src={o.imageUrl} alt="" className="h-full w-full object-cover" /> : <Gift className="h-7 w-7" />}</div>
                      <p className="mt-3 text-xs font-semibold tracking-wide text-slate-500">OPTION {String.fromCharCode(65 + i)}{chosen ? " · CHOSEN" : ""}</p>
                      <p className="mt-1 font-semibold">{o.name}</p>
                      {o.description && <p className="mt-1 text-sm text-slate-500">{o.description}</p>}
                      <p className="mt-2 text-sm"><strong className="text-base">{inr(o.price)}</strong> <span className="text-slate-500">per recipient</span></p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {!!data.allowedActions?.length && (
            <Card className="space-y-3 border-brand/30 bg-brand-soft/40 p-5">
              <div><h3 className="font-semibold text-slate-900">Team actions</h3><p className="text-sm text-slate-500">Move this request along.</p></div>
              <RequestActions key={`${r.id}:${r.status}`} requestId={r.id} allowed={data.allowedActions} onDone={(updated) => { detail.setData(updated); void detail.reload(); }} />
            </Card>
          )}
          {data.actionsEnabled === false && <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">{data.pilotOnly ? "View only. Changes from the CRM are in a pilot that does not include you yet." : "View only. Acting from the CRM is switched off; use Gifting OS."}</p>}

          <Card className="space-y-5 p-6">
            <h3 className="text-base font-semibold text-slate-900">Request brief</h3>
            <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-3">
              <Brief label="Request ID">{r.requestCode}</Brief><Brief label="Recipient">{r.recipientName}</Brief>
              <Brief label={r.eventName ? "Event" : "Occasion"}>{r.occasionName ?? (r.eventName ? `${r.eventName}${r.eventDate ? ` · ${shortDay(r.eventDate)}` : ""}` : null)}</Brief>
              <Brief label="Required delivery date">{r.deliveryDate ? day(r.deliveryDate) : null}</Brief><Brief label="Budget">{budgetLabel(r)}</Brief><Brief label="Initiated by">{r.initiatedVia ? labelFrom(INITIATED_VIA, r.initiatedVia) : null}</Brief>
            </dl>
            <dl className="grid gap-x-8 gap-y-4 border-t border-slate-200 pt-4 text-sm sm:grid-cols-3">
              <Brief label="Relationship">{[r.relationship, r.relationshipContext].filter(Boolean).join(" · ")}</Brief>
              <Brief label="Gift style">{r.giftStyle ? labelFrom(GIFT_STYLES, r.giftStyle) : null}</Brief>
              <Brief label="Gift purpose">{r.giftPurpose ? labelFrom(GIFT_PURPOSES, r.giftPurpose) : null}</Brief>
              <Brief label="Interests">{r.interests?.join(", ")}</Brief>
            </dl>
            <dl className="space-y-4 border-t border-slate-200 pt-4 text-sm">
              <Brief label="Delivery address">{r.deliveryAddress}</Brief><Brief label="Gift message">{r.message ? `“${r.message}”` : null}</Brief>
              <Brief label="Special instructions">{r.specialInstructions}</Brief><Brief label="Gift preferences">{r.giftPreferences}</Brief>
            </dl>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="p-5">
            <h3 className="font-semibold text-slate-900">Recipient</h3>
            <div className="mt-3 flex items-center gap-3">
              <Avatar name={r.recipientName} src={r.recipientAvatarUrl} size="md" />
              <div className="min-w-0"><p className="truncate font-medium">{r.recipientName ?? "—"}</p><p className="truncate text-xs text-slate-500">{[r.relationship, r.recipientMobile].filter(Boolean).join(" · ")}</p></div>
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-slate-900">Activity</h3>
            <ol className="mt-4 space-y-4">
              {[...history].reverse().map((h) => (
                <li key={h.id} className="flex gap-3">
                  <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", metaOf(h.toStatus).dot)} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{eventTitle(h.toStatus, h.fromStatus)}</p>
                    <p className="text-xs text-slate-500">{h.actorName ?? "TOFAA"}{h.actorRole === "KAM" ? " (KAM)" : h.actorRole === "SUPER_ADMIN" ? " (TOFAA)" : ""} · {dayTime(h.createdAt)}</p>
                    {h.note && <p className="mt-1 break-words rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">{h.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Brief({ label, children }: { label: string; children?: ReactNode }) {
  if (!children || children === "—") return null;
  return <div><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-0.5 whitespace-pre-line text-slate-900">{children}</dd></div>;
}
