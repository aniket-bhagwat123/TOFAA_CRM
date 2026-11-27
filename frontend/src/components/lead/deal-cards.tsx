"use client";
import { CalendarCheck, Check, Download, FilePlus2, FileSignature, FileText, Handshake, Images, NotebookPen, Pencil, Plus, Send, Wallet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { Sheet } from "@/components/ui/sheet";
import { openPdf } from "@/features/media/download";
import { formatDate, formatDateTime } from "@/lib/format";
import { inr, inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { DealData, Lead, MeetingItem, Quotation, QuotationStatus } from "@/types/crm";

/** The shared card: an icon in a soft circle, a title, one line under it, and the main action on the right. */
export function CardShell({ icon: Icon, title, subtitle, action, children, className }: { icon: typeof Handshake; title: string; subtitle?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm sm:p-5", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
          {subtitle && <div className="text-xs leading-snug text-slate-500">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// Quiet tinted action in a card header (Apple-style): no border, soft brand fill.
const pill = "min-h-8 shrink-0 rounded-lg border-transparent bg-brand-soft px-3 py-1 text-xs text-brand hover:bg-violet-100";

// --- deal details -------------------------------------------------------------------------------------------

export function DealDetailsCard({ lead, deal, onSaved }: { lead: Lead; deal: DealData | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const amount = deal?.value.amount ?? null;
  return (
    <CardShell icon={Handshake} title="Deal details" className="space-y-5">
      {amount ? (
        <div className="mt-3.5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xl font-semibold tracking-tight text-slate-900">{inr(amount)}</div>
            {deal?.value.source && <span className="mt-1 inline-block rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold capitalize text-brand">{deal.value.source}</span>}
          </div>
          {!deal?.value.quoted && !deal?.value.paid && <Button variant="secondary" className={pill} onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit amount</Button>}
        </div>
      ) : (
        <div className="mt-3.5 flex flex-wrap items-center gap-4 sm:pl-11">
          <span className="relative flex h-16 w-14 items-center justify-center rounded-xl bg-violet-50 text-violet-300">
            <FilePlus2 className="h-8 w-8" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-900">No deal amount added yet</div>
            <div className="text-sm text-slate-500">Add the deal amount to track your deal value.</div>
          </div>
          <Button onClick={() => setEditing(true)} disabled={lead.stage === "closed_won" || lead.stage === "closed_lost"}>Add deal amount</Button>
        </div>
      )}
      <div className="grid grid-cols-3 divide-x divide-slate-200 border-t border-slate-100 pt-4 text-sm">
        {[["Estimate", deal?.value.estimate], ["Quoted", deal?.value.quoted], ["Paid", deal?.value.paid]].map(([label, v]) => (
          <div key={label as string} className="px-3 first:pl-0"><span className="text-slate-500">{label}</span> <b className="ml-2 text-slate-800">{inrShort(v as number | null)}</b></div>
        ))}
      </div>
      <DealAmountSheet open={editing} lead={lead} current={deal?.value.estimate ?? null} onClose={() => setEditing(false)} onSaved={onSaved} />
    </CardShell>
  );
}

function DealAmountSheet({ open, lead, current, onClose, onSaved }: { open: boolean; lead: Lead; current: number | null; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setValue(current ? String(current) : ""); setError(undefined); } }, [open, current]);

  async function save() {
    if (!(Number(value) > 0)) return setError(value ? "Amount must be greater than 0" : "Enter the deal amount");
    setBusy(true);
    try {
      await apiClient.patch(`/leads/${lead.id}`, { version: lead.version, estimateAmount: Number(value) });
      toast.success("Deal amount saved");
      onClose();
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Deal amount" subtitle="Your best estimate. The quotation total replaces it later." icon={Handshake} tone="violet" onClose={onClose}>
      <div className="space-y-4">
        <InputField label="Amount (₹)" type="number" required autoFocus value={value} onChange={(e) => { setValue(e.target.value); setError(undefined); }} error={error} />
        <Button onClick={save} loading={busy} className="w-full">Save amount</Button>
      </div>
    </Sheet>
  );
}

// --- meeting notes (minutes) -------------------------------------------------------------------------------------

export function MeetingNotesCard({ deal, closed, onAdd }: { deal: DealData | null; closed: boolean; onAdd: () => void }) {
  const minutes = deal?.minutes ?? [];
  return (
    <CardShell
      icon={NotebookPen}
      title="Meeting notes"
      subtitle={minutes.length ? `${minutes.length} saved` : "Keep key points from your conversation here"}
      action={<Button variant="secondary" className={pill} disabled={closed} onClick={onAdd}><Plus className="h-3.5 w-3.5" /> Add meeting notes</Button>}
    >
      {minutes.length > 0 && (
        <ul className="mt-3.5 space-y-2.5">
          {minutes.slice(0, 3).map((m) => (
            <li key={m.id} className="rounded-2xl bg-slate-50 p-3.5 text-sm">
              {m.body && <p className="line-clamp-4 whitespace-pre-wrap text-slate-700">{m.body}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
                <span>{m.author?.fullName ?? "—"} · {formatDate(m.createdAt)}</span>
                {m.fileUrl && <a href={m.fileUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium text-brand hover:underline"><Download className="h-3 w-3" />{m.fileName ?? "File"}</a>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

// --- quotes ---------------------------------------------------------------------------------------------------------

export const QUOTE_STATUS: Record<QuotationStatus, { label: string; tone: string }> = {
  ready: { label: "Ready to send", tone: "bg-slate-100 text-slate-700" },
  pending_approval: { label: "Waiting for approval", tone: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved", tone: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", tone: "bg-red-100 text-red-700" },
  sent: { label: "Sent", tone: "bg-sky-100 text-sky-800" },
};

export function QuotesCard({ deal, closed, onCreate, onSend }: { deal: DealData | null; closed: boolean; onCreate: () => void; onSend: (q: Quotation) => void }) {
  const quotes = deal?.quotations ?? [];
  return (
    <CardShell
      icon={FileText}
      title="Quotes"
      subtitle={quotes.length ? `${quotes.length} ${quotes.length === 1 ? "version" : "versions"}` : "No quotes created yet"}
      action={<Button variant="secondary" className={pill} disabled={closed} onClick={onCreate}><Plus className="h-3.5 w-3.5" /> {quotes.length ? "New version" : "Create a quote"}</Button>}
    >
      {quotes.length > 0 && (
        <ul className="mt-3.5 space-y-2.5">
          {quotes.map((q) => (
            <li key={q.id} className="rounded-2xl border border-slate-200 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-semibold text-slate-500">v{q.version}</span>
                  <span className="text-base font-semibold text-slate-900">{inr(q.total)}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", QUOTE_STATUS[q.status].tone)}>{q.status === "sent" && q.sentVia ? `Sent by ${q.sentVia}` : QUOTE_STATUS[q.status].label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" className="min-h-8 px-2.5 py-1 text-xs" onClick={() => void openPdf(`/quotations/${q.id}/pdf`)}><Download className="h-3.5 w-3.5" /> PDF</Button>
                  {["ready", "approved", "sent"].includes(q.status) && !closed && (
                    <Button className="min-h-8 px-3 py-1 text-xs" onClick={() => onSend(q)}><Send className="h-3.5 w-3.5" /> {q.status === "sent" ? "Send again" : "Send"}</Button>
                  )}
                </div>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {q.number} · {formatDate(q.createdAt)} · {q.packages?.length ? `${q.packages.length} ${q.packages.length === 1 ? "requirement" : "requirements"}` : `${q.items.length} ${q.items.length === 1 ? "item" : "items"}`}{q.discountPct ? ` · ${q.discountPct}% discount` : ""}
              </div>
              {q.status === "pending_approval" && <p className="mt-1.5 text-xs text-amber-700">Discount {q.discountPct}% is above the {q.discountLimit ?? 0}% limit. Your manager has been asked to approve it.</p>}
              {q.status === "rejected" && <p className="mt-1.5 text-xs text-red-600">Rejected{q.decisionNote ? `: ${q.decisionNote}` : ""}. Make a new version with a lower discount.</p>}
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

// --- samples ---------------------------------------------------------------------------------------------------------

/** Sample images and files per item, and when they last went to the client. */
export function SamplesCard({ deal, closed, onOpen }: { deal: DealData | null; closed: boolean; onOpen: () => void }) {
  const items = deal?.samples?.items ?? [];
  const last = deal?.samples?.lastSent;
  const files = items.reduce((n, i) => n + i.files.length, 0);
  const subtitle = last
    ? `Sent by ${last.channel} on ${formatDate(last.sentAt)} · ${last.itemCount} ${last.itemCount === 1 ? "item" : "items"}, ${last.fileCount} ${last.fileCount === 1 ? "file" : "files"}`
    : items.length ? `${items.length} ${items.length === 1 ? "item" : "items"}, ${files} ${files === 1 ? "file" : "files"} · not sent yet` : "No samples yet";
  return (
    <CardShell
      icon={Images}
      title="Samples"
      subtitle={subtitle}
      action={<Button variant="secondary" className={pill} disabled={closed} onClick={onOpen}>{items.length ? <><Pencil className="h-3.5 w-3.5" /> Manage</> : <><Plus className="h-3.5 w-3.5" /> Add samples</>}</Button>}
    >
      {items.length > 0 && (
        <ul className="mt-3.5 space-y-2">
          {items.map((it, n) => (
            <li key={it.id ?? n} className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5">
              <div className="flex shrink-0 -space-x-2">
                {it.files.slice(0, 3).map((f) =>
                  (f.mime ?? "").startsWith("image/") && f.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={f.path} src={f.url} alt="" className="h-9 w-9 rounded-lg border-2 border-white object-cover" />
                  ) : (
                    <span key={f.path} className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-white bg-slate-100 text-slate-400"><FileText className="h-4 w-4" /></span>
                  ),
                )}
                {it.files.length === 0 && <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-300"><Images className="h-4 w-4" /></span>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{it.itemName}</div>
                <div className="truncate text-xs text-slate-400">{[it.packageName, `${it.files.length} ${it.files.length === 1 ? "file" : "files"}`].filter(Boolean).join(" · ")}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

// --- agreement and payment ---------------------------------------------------------------------------------------------

function Step({ done, label, children }: { done: boolean; label: string; children?: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", done ? "bg-emerald-500 text-white" : "border-2 border-slate-200 text-transparent")}><Check className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-medium", done ? "text-slate-800" : "text-slate-500")}>{label}</div>
        {children && <div className="mt-0.5 text-xs text-slate-500">{children}</div>}
      </div>
    </li>
  );
}

export function AgreementCard({ lead, deal, closed, onPrepare, onPayment, onReload }: { lead: Lead; deal: DealData | null; closed: boolean; onPrepare: () => void; onPayment: () => void; onReload: () => void }) {
  const [busy, setBusy] = useState(false);
  const ag = deal?.agreement;
  const pay = ag?.payment;

  async function markSent() {
    setBusy(true);
    try {
      await apiClient.post(`/leads/${lead.id}/agreement/sent`);
      onReload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardShell
      icon={FileSignature}
      title="Agreement & payment"
      subtitle={pay?.status === "confirmed" ? "Paid" : ag?.details ? `Prepared · ${inr(ag.totalAmount ?? 0)}${ag.termsStatus === "pending" ? " · terms waiting for approval" : ag.termsStatus === "rejected" ? " · terms rejected" : ""}` : "Prepared, sent, invoiced, paid"}
      action={
        <div className="flex items-center gap-1.5">
          {ag?.details && <Button variant="ghost" className="min-h-8 px-2.5 py-1 text-xs" onClick={() => void openPdf(`/leads/${lead.id}/agreement/pdf`)}><Download className="h-3.5 w-3.5" /> PDF</Button>}
          <Button variant="secondary" className={pill} disabled={closed} onClick={onPrepare}>{ag?.details ? <><Pencil className="h-3.5 w-3.5" /> Edit agreement</> : <><Plus className="h-3.5 w-3.5" /> Prepare agreement</>}</Button>
        </div>
      }
    >
      <ol className="mt-3.5 grid gap-4 sm:grid-cols-2">
        <Step done={!!ag?.details} label="Agreement prepared">
          {ag?.details ? <span className="inline-flex items-center gap-2">{ag.preparedAt ? formatDate(ag.preparedAt) : "Ready"} · {inr(ag.totalAmount ?? 0)}</span>
            : <button type="button" disabled={closed} onClick={onPrepare} className="font-medium text-brand hover:underline disabled:opacity-50">Prepare the agreement</button>}
        </Step>
        <Step done={!!ag?.sentAt} label="Agreement sent">
          {ag?.sentAt ? formatDate(ag.sentAt) : <button type="button" disabled={closed || busy} onClick={markSent} className="font-medium text-brand hover:underline disabled:opacity-50">Mark as sent</button>}
        </Step>
        <Step done={!!ag?.invoiceRaisedAt} label="Payment requested">
          {ag?.invoiceRaisedAt ? formatDate(ag.invoiceRaisedAt) : (ag?.details || lead.stage === "agreement_payment") && !closed
            ? <Button className="mt-1 min-h-8 px-3 py-1 text-xs" onClick={onPayment}><Wallet className="h-3.5 w-3.5" /> Request payment</Button>
            : "After the agreement is prepared"}
        </Step>
        <Step done={pay?.status === "confirmed"} label="Payment received">
          {pay?.status === "confirmed" ? `${inr(pay.amountPaid)}${pay.confirmedAt ? ` · ${formatDate(pay.confirmedAt)}` : ""}`
            : pay?.status === "partial" ? `${inr(pay.amountPaid)} of ${inr(pay.amount)} received`
            : pay ? "Waiting for Finance to record it" : "Only Finance or the ERP can mark this"}
        </Step>
      </ol>
    </CardShell>
  );
}

// --- upcoming meetings ------------------------------------------------------------------------------------------------------

export function MeetingsCard({ meetings, onDone, onCancel }: { meetings: MeetingItem[]; onDone: (id: string) => void; onCancel: (id: string) => void }) {
  if (!meetings.length) return null;
  return (
    <CardShell icon={CalendarCheck} title={meetings.length === 1 ? "Upcoming meeting" : "Upcoming meetings"}>
      <ul className="mt-3.5 space-y-2">
        {meetings.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm">
            <span><b className="text-slate-800">{formatDateTime(m.startsAt)}</b> · {m.kind === "online" ? "Online" : "Physical"}{m.location || m.link ? ` · ${m.location ?? m.link}` : ""}</span>
            <span className="flex gap-1.5">
              <Button variant="secondary" className="min-h-8 px-3 py-1 text-xs" onClick={() => onDone(m.id)}>Done</Button>
              <Button variant="ghost" className="min-h-8 px-3 py-1 text-xs text-red-600" onClick={() => onCancel(m.id)}>Cancel</Button>
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
