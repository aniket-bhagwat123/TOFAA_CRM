"use client";
import { Gift } from "lucide-react";
import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import type { GiftRequestDetail } from "@/types/gifting";
import { budgetText, dayText, statusOf } from "./labels";
import { RequestActions } from "./request-actions";

/** One gift request with its proposal, history and the KAM's next steps. */
export function RequestSheet({ requestId, onClose, onChanged }: { requestId: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<GiftRequestDetail>(requestId ? `/gifting-requests/${requestId}` : null);
  const data = detail.data?.request.id === requestId ? detail.data : null; // never show the previous request's copy
  const r = data?.request;
  return (
    <Sheet open={!!requestId} title={r?.title ?? "Gift request"} subtitle={r ? [r.requestCode, r.accountName].filter(Boolean).join(" · ") : undefined} icon={Gift} tone="indigo" onClose={onClose} width="lg">
      {detail.error && !r ? <StateView kind="error" message={detail.error} onRetry={() => void detail.reload()} />
        : !data || !r ? <div className="flex justify-center py-12"><Spinner /></div>
          : (
            <div className="space-y-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", statusOf(r.status).tone)}>{statusOf(r.status).label}</span>
                {r.statusNote && <span className="text-slate-600">{r.statusNote}</span>}
              </div>
              <RequestActions key={`${r.id}:${r.status}`} requestId={r.id} allowed={data.allowedActions ?? []}
                onDone={(next) => { detail.setData(next); void detail.reload(); onChanged(); }} />
              <dl className="grid gap-3 sm:grid-cols-2">
                <Field label="Recipient">{[r.recipientName, r.recipientMobile].filter(Boolean).join(" · ")}</Field>
                <Field label={r.eventName ? "Event" : "Occasion"}>{[r.eventName ?? r.occasionName, dayText(r.eventDate ?? r.occasionDate)].filter((x) => x && x !== "—").join(" · ")}</Field>
                <Field label="Deliver by">{dayText(r.deliveryDate)}</Field>
                <Field label="Budget">{budgetText(r)}</Field>
                <Field label="Relationship">{r.relationship}</Field>
                <Field label="Requested by">{r.createdByName}</Field>
                <Field label="Delivery address" wide>{r.deliveryAddress}</Field>
                <Field label="Purpose" wide>{r.purpose}</Field>
                <Field label="Interests" wide>{r.interests?.join(", ")}</Field>
                <Field label="Gift preferences" wide>{r.giftPreferences}</Field>
                <Field label="Message" wide>{r.message}</Field>
                <Field label="Special instructions" wide>{r.specialInstructions}</Field>
              </dl>
              {r.proposal && (
                <section className="space-y-2">
                  <h3 className="font-semibold text-slate-900">Proposal</h3>
                  {r.proposal.note && <p className="text-slate-600">{r.proposal.note}</p>}
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {r.proposal.options.map((o, i) => (
                      <li key={`${o.name}-${i}`} className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-900">{o.name}{r.selectedOptionIndex === i && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Chosen</span>}</span>
                          {o.description && <span className="block text-slate-500">{o.description}</span>}
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-700">₹{Number(o.price).toLocaleString("en-IN")}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="space-y-2">
                <h3 className="font-semibold text-slate-900">History</h3>
                <ol className="space-y-2 border-l border-slate-200 pl-4">
                  {data.history.map((h) => (
                    <li key={h.id}>
                      <p className="font-medium text-slate-800">{statusOf(h.toStatus).label}</p>
                      <p className="text-xs text-slate-500">{[dayText(h.createdAt), h.actorName].filter(Boolean).join(" · ")}</p>
                      {h.note && <p className="text-slate-600">{h.note}</p>}
                    </li>
                  ))}
                </ol>
              </section>
              {data.actionsEnabled === false && <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">{data.pilotOnly ? "View only. Changes from the CRM are in a pilot that does not include you yet." : "View only. Acting from the CRM is switched off; use Gifting OS."}</p>}
            </div>
          )}
    </Sheet>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children?: ReactNode }) {
  if (!children || children === "—") return null;
  return <div className={wide ? "sm:col-span-2" : undefined}><dt className="text-xs text-slate-500">{label}</dt><dd className="font-medium text-slate-900">{children}</dd></div>;
}
