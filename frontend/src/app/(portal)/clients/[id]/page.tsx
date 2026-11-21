"use client";
import { CalendarClock, CalendarHeart, Check, FolderPlus, MessageCircle, Phone, PhoneIncoming, Plus, Repeat, Settings2, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { toast } from "sonner";
import { TIER_TONE } from "@/components/clients/client-card";
import { ContactSheet, ManageClientSheet, OccasionSheet } from "@/components/clients/client-small-sheets";
import { ClientFollowUpSheet, ScheduleClientSheet, type ClientTaskTarget } from "@/components/clients/followup-sheets";
import { ProjectSheet, type ProjectMode } from "@/components/clients/project-sheet";
import { RepeatSheet } from "@/components/clients/repeat-sheet";
import { SendQuotationSheet } from "@/components/crm/send-quotation-sheet";
import { Timeline } from "@/components/crm/timeline";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { StageBadge } from "@/components/ui/stage-badge";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { followUpLabel, formatDate, openWhatsApp, telHref } from "@/lib/format";
import { inrShort } from "@/lib/money";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { ClientDetail, Lead, Quotation } from "@/types/crm";

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
    <div className="text-base font-semibold text-slate-900">{value}</div>
  </div>
);

function ProjectRow({ p }: { p: Lead }) {
  const closed = p.stage === "closed_won" || p.stage === "closed_lost";
  const fu = followUpLabel(p.nextFollowUp);
  return (
    <Link href={`/projects/${p.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 transition-colors hover:border-brand/40 hover:bg-brand-soft/30">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-900">{p.projectTitle ?? (p.pipeline === "client" ? "Project" : "First order")}</div>
        <div className="truncate text-xs text-slate-500">
          {p.occasion ? `${p.occasion} · ` : ""}{p.origin === "inbound" ? "Client called in · " : p.origin === "repeat" ? "Repeat order · " : ""}{closed ? `Closed ${formatDate((p as Lead & { closedAt?: string }).closedAt ?? p.createdAt)}` : <span className={fu.tone}>{fu.text}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StageBadge stage={p.stage} />
        <span className="text-xs font-medium text-slate-600">{inrShort(p.dealValue)}</span>
      </div>
    </Link>
  );
}

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const detail = useApi<ClientDetail>(`/clients/${id}`);
  const reload = () => void detail.reload();

  const [project, setProject] = useState<ProjectMode | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [sending, setSending] = useState<{ projectId: string; quotation: Quotation } | null>(null);
  const [schedule, setSchedule] = useState(false);
  const [finishing, setFinishing] = useState<ClientTaskTarget | null>(null);
  const [occasion, setOccasion] = useState(false);
  const [contact, setContact] = useState(false);
  const [manage, setManage] = useState(false);

  if (detail.loading && !detail.data) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!detail.data) return <StateView kind="error" message={detail.error ?? "We could not find this client."} onRetry={reload} action={<Link href="/clients"><Button variant="secondary">Back to clients</Button></Link>} />;

  const { client, contacts, projects, occasions, followups, timeline } = detail.data;
  const primary = contacts[0];
  const open = projects.filter((p) => p.stage !== "closed_won" && p.stage !== "closed_lost");
  const history = projects.filter((p) => p.stage === "closed_won" || p.stage === "closed_lost");
  const target = { id: client.id, name: client.name };

  async function removeOccasion(oid: string) {
    try {
      await apiClient.delete(`/clients/${id}/occasions/${oid}`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const action = (label: string, Icon: typeof Phone, onClick: () => void, primaryStyle = false, disabled = false) => (
    <Button variant={primaryStyle ? "primary" : "secondary"} onClick={onClick} disabled={disabled} className="flex-col gap-1 py-3 text-xs sm:text-sm"><Icon className="h-5 w-5" />{label}</Button>
  );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        {/* header */}
        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <Avatar src={primary?.photoUrl} name={client.name} size="lg" square />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-xl font-semibold">{client.name}</h1>
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1", TIER_TONE[client.tier])} title={client.tierIsManual ? "Set by a manager" : "From the last 12 months of revenue"}>Tier {client.tier}</span>
                  {client.status === "dormant" && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">Dormant</span>}
                </div>
                <p className="text-sm text-slate-500">{primary ? `${primary.name}${primary.designation ? `, ${primary.designation}` : ""}` : "No contact"}{client.city ? ` · ${client.city}` : ""}</p>
                <p className="text-xs text-slate-400">Client since {client.clientSince ? formatDate(client.clientSince) : "—"} · Owner {client.owner?.fullName ?? "—"}</p>
              </div>
            </div>
            {role && isManager(role) && <Button variant="ghost" className="min-h-9 px-2.5" onClick={() => setManage(true)} aria-label="Manage client"><Settings2 className="h-4 w-4" /></Button>}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Lifetime" value={inrShort(client.lifetimeValue)} />
            <Stat label="Last 12 months" value={inrShort(client.revenue12m)} />
            <Stat label="Orders" value={String(client.wonProjects)} />
            <Stat label="Last order" value={client.lastOrderAt ? formatDate(client.lastOrderAt) : "—"} />
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {action("Call", Phone, () => { const h = telHref(primary?.phone); if (h) window.location.href = h; }, true, !primary?.phone)}
            {action("WhatsApp", MessageCircle, () => openWhatsApp(primary?.phone), false, !primary?.phone)}
            {action("New project", FolderPlus, () => setProject("new"))}
            {action("Requirement", PhoneIncoming, () => setProject("inbound"))}
            {action("Repeat order", Repeat, () => setRepeat(true), false, !history.some((p) => p.stage === "closed_won"))}
            {action("Follow-up", CalendarClock, () => setSchedule(true))}
          </div>
        </Card>

        {/* projects */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Open projects <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{open.length}</span></h2>
            <div className="flex items-center gap-1.5">
              <Link href={`/projects?client=${id}`} className="rounded-lg px-2 py-1 text-xs font-medium text-brand hover:bg-brand-soft">All in Projects</Link>
              <Button variant="secondary" className="min-h-8 px-3 py-1 text-xs" onClick={() => setProject("new")}><Plus className="h-3.5 w-3.5" /> New project</Button>
            </div>
          </div>
          {open.length === 0 ? <p className="text-sm text-slate-400">Nothing in progress. An occasion coming up is a good reason to call.</p> : <div className="space-y-2">{open.map((p) => <ProjectRow key={p.id} p={p} />)}</div>}
          {history.length > 0 && (
            <>
              <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">History</h3>
              <div className="space-y-2">{history.map((p) => <ProjectRow key={p.id} p={p} />)}</div>
            </>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-[13px] font-semibold text-slate-700">Timeline</h2>
          <Timeline items={timeline} />
        </Card>
      </div>

      {/* right column */}
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarHeart className="h-4 w-4 text-indigo-500" /> Occasions</h2>
            <button type="button" onClick={() => setOccasion(true)} className="pressable rounded-full p-1.5 text-brand hover:bg-brand-soft" aria-label="Add occasion"><Plus className="h-4 w-4" /></button>
          </div>
          {occasions.length === 0 ? (
            <p className="text-xs text-slate-400">Add their gifting occasions (Diwali, New Year, company anniversary ...). You will get a call reminder in time to win the order.</p>
          ) : occasions.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{o.name}</div>
                <div className={cn("text-xs", o.daysAway != null && o.daysAway <= o.leadDays ? "font-medium text-indigo-600" : "text-slate-400")}>
                  {o.nextDate ? `${formatDate(o.nextDate)} · in ${o.daysAway} days` : "Date not in the calendar yet"}
                </div>
              </div>
              <button type="button" onClick={() => removeOccasion(o.id)} className="pressable rounded-full p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500" aria-label={`Remove ${o.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Follow-ups</h2>
            <button type="button" onClick={() => setSchedule(true)} className="pressable rounded-full p-1.5 text-brand hover:bg-brand-soft" aria-label="Schedule follow-up"><Plus className="h-4 w-4" /></button>
          </div>
          {followups.length === 0 ? <p className="text-xs text-slate-400">No client follow-ups planned.</p> : followups.map((t) => {
            const fu = followUpLabel(t.dueDate);
            return (
              <div key={t.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-sm"><div className="truncate font-medium text-slate-800">{t.title ?? "Check in"}</div><div className={cn("text-xs", fu.tone)}>{fu.text}</div></div>
                <Button variant="secondary" className="min-h-8 shrink-0 px-2.5 py-1 text-xs" onClick={() => setFinishing({ taskId: t.id, companyId: client.id, companyName: client.name, title: t.title })}><Check className="h-3.5 w-3.5" /> Done</Button>
              </div>
            );
          })}
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Contacts</h2>
            <button type="button" onClick={() => setContact(true)} className="pressable rounded-full p-1.5 text-brand hover:bg-brand-soft" aria-label="Add contact"><UserPlus className="h-4 w-4" /></button>
          </div>
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5">
              <Avatar src={c.photoUrl} name={c.name} size="sm" />
              <div className="min-w-0 flex-1 text-sm"><div className="truncate font-medium">{c.name}</div><div className="truncate text-xs text-slate-400">{c.designation ?? c.phone ?? c.email}</div></div>
              {c.phone && <a href={telHref(c.phone)} className="pressable rounded-full p-1.5 text-emerald-600 hover:bg-emerald-50" aria-label={`Call ${c.name}`}><Phone className="h-4 w-4" /></a>}
            </div>
          ))}
        </Card>
      </div>

      <ProjectSheet clientId={project ? id : null} clientName={client.name} mode={project ?? "new"} contacts={contacts} occasions={occasions.map((o) => o.name)} onClose={() => setProject(null)} onDone={(pid) => router.push(`/projects/${pid}`)} />
      <RepeatSheet clientId={repeat ? id : null} clientName={client.name} projects={projects} onClose={() => setRepeat(false)} onDone={(pid, q) => { reload(); setSending({ projectId: pid, quotation: q }); }} />
      <SendQuotationSheet
        target={sending ? { leadId: sending.projectId, name: client.name, stage: "project_follow_up", pipeline: "client" } : null}
        quotation={sending?.quotation ?? null}
        onClose={() => setSending(null)}
        onDone={reload}
      />
      <ScheduleClientSheet client={schedule ? target : null} onClose={() => setSchedule(false)} onDone={reload} />
      <ClientFollowUpSheet target={finishing} onClose={() => setFinishing(null)} onDone={(pid) => (pid ? router.push(`/projects/${pid}`) : reload())} />
      <OccasionSheet client={occasion ? target : null} onClose={() => setOccasion(false)} onDone={reload} />
      <ContactSheet client={contact ? target : null} onClose={() => setContact(false)} onDone={reload} />
      <ManageClientSheet client={manage ? client : null} onClose={() => setManage(false)} onDone={reload} />
    </div>
  );
}
