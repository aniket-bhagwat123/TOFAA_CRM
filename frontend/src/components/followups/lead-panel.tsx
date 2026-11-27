"use client";
import { CalendarClock, ExternalLink, Mail, Phone, StickyNote, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Timeline } from "@/components/crm/timeline";
import { NoteSheet } from "@/components/lead/note-sheet";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StageBadge } from "@/components/ui/stage-badge";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { formatDate, formatDateTime } from "@/lib/format";
import { inrShort } from "@/lib/money";
import type { LeadDetail } from "@/types/crm";
import { KIND_LABEL } from "./followup-card";

type Props = { leadId: string | null; onClose: () => void };

/** Clicking a card: the lead in a side panel (contacts, next action, notes, timeline) without leaving the board. */
export function LeadPanel({ leadId, onClose }: Props) {
  const router = useRouter();
  const detail = useApi<LeadDetail>(leadId ? `/leads/${leadId}` : null);
  const [noting, setNoting] = useState(false);

  useEffect(() => {
    if (!leadId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !noting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leadId, noting, onClose]);

  if (!leadId) return null;
  const d = detail.data?.lead.id === leadId ? detail.data : null;
  const lead = d?.lead;
  const name = lead ? (lead.projectTitle && lead.pipeline === "client" ? `${lead.company.name} · ${lead.projectTitle}` : lead.company.name) : "";
  const notes = d?.timeline.filter((a) => a.kind === "note" && a.note) ?? [];
  const fullPage = lead ? (lead.pipeline === "client" ? `/projects/${lead.id}` : `/leads/${lead.id}`) : "";

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label={name || "Lead"} className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-sheet">
        <header className="flex items-start gap-3 border-b border-slate-100 p-4">
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 text-base font-semibold text-slate-900">{name || " "}</h2>
            {lead && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <StageBadge stage={lead.stage} />
                {lead.dealValue ? <span className="font-medium text-slate-700">{inrShort(lead.dealValue)}</span> : null}
                {lead.owner?.fullName && <span>· {lead.owner.fullName}</span>}
              </div>
            )}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="pressable rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {detail.loading && !d ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : detail.error && !d ? (
            <StateView kind="error" message={detail.error} onRetry={() => void detail.reload()} />
          ) : lead && d ? (
            <>
              <Section title="Contacts">
                <Contact photo={lead.contact.photoUrl} name={lead.contact.name} role={lead.contact.designation} phone={lead.contact.phone} email={lead.contact.email} />
                {lead.contact.altPhone && <Contact name={lead.contact.altName || "Second number"} role="Second number" phone={lead.contact.altPhone} />}
              </Section>

              <Section title="Next action">
                {d.tasks.length ? d.tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2.5 rounded-xl bg-slate-50 p-3 text-sm">
                    <CalendarClock className="h-4 w-4 shrink-0 text-brand" />
                    <span className="font-medium text-slate-800">{KIND_LABEL[t.kind] ?? "Follow-up"}</span>
                    <span className="text-slate-500">· {formatDate(t.dueDate)}</span>
                    {t.title && <span className="min-w-0 truncate text-slate-500">· {t.title}</span>}
                  </div>
                )) : <p className="text-sm text-amber-700">No next action set.</p>}
              </Section>

              <Section title="Notes" action={<Button variant="ghost" onClick={() => setNoting(true)} className="h-8 min-h-0 px-2 text-xs"><StickyNote className="h-3.5 w-3.5" />Add note</Button>}>
                {lead.notes && <p className="whitespace-pre-line rounded-xl bg-amber-50/60 p-3 text-sm text-slate-700">{lead.notes}</p>}
                {notes.slice(0, 5).map((n) => (
                  <div key={n.id} className="rounded-xl border border-slate-100 p-3">
                    <p className="whitespace-pre-line text-sm text-slate-700">{n.note}</p>
                    <p className="mt-1 text-[12px] text-slate-400">{n.actor?.fullName ? `${n.actor.fullName} · ` : ""}{formatDateTime(n.createdAt)}</p>
                  </div>
                ))}
                {!lead.notes && !notes.length && <p className="text-sm text-slate-500">No notes yet.</p>}
              </Section>

              <Section title="Timeline"><Timeline items={d.timeline} /></Section>
            </>
          ) : null}
        </div>

        {lead && (
          <footer className="border-t border-slate-100 p-3">
            <Button variant="secondary" onClick={() => router.push(fullPage)} className="w-full"><ExternalLink className="h-4 w-4" />Open full page</Button>
          </footer>
        )}
      </aside>
      {lead && <NoteSheet leadId={lead.id} name={name} open={noting} onClose={() => setNoting(false)} onSaved={() => void detail.reload()} />}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Contact({ photo, name, role, phone, email }: { photo?: string | null; name: string; role?: string | null; phone?: string | null; email?: string | null }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-100 p-3">
      {photo !== undefined ? <Avatar src={photo} name={name} size="sm" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400"><UserRound className="h-4 w-4" /></span>}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
        {role && <div className="truncate text-xs text-slate-500">{role}</div>}
        {phone && <a href={`tel:${phone}`} className="flex items-center gap-1.5 text-xs text-brand hover:underline"><Phone className="h-3 w-3" />{phone}</a>}
        {email && <a href={`mailto:${email}`} className="flex min-w-0 items-center gap-1.5 truncate text-xs text-brand hover:underline"><Mail className="h-3 w-3 shrink-0" />{email}</a>}
      </div>
    </div>
  );
}
