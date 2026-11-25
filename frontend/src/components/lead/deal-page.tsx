"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EditLeadSheet } from "@/components/crm/edit-lead-sheet";
import { leadTarget } from "@/components/crm/lead-card";
import { useLeadActions } from "@/components/crm/use-lead-actions";
import { AgreementCard, DealDetailsCard, MeetingNotesCard, MeetingsCard, QuotesCard, SamplesCard } from "@/components/lead/deal-cards";
import { DeleteRecordDialog } from "@/components/crm/delete-record-dialog";
import { LeadHeader } from "@/components/lead/lead-header";
import { NoteSheet } from "@/components/lead/note-sheet";
import { StageProgress } from "@/components/lead/stage-progress";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { setCrumb } from "@/lib/crumb";
import { PIPELINE_STAGES } from "@/lib/format";
import { isManager } from "@/lib/roles";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { DealData, LeadDetail, StageKey } from "@/types/crm";

export type DealArea = "leads" | "projects";

/**
 * One deal, new business or a client project: who, how to reach them, what is next, the actions, the road (stage),
 * and the deal itself (amount, meeting notes, quotes, agreement, payment). History lives in Activity.
 * It is shown under /leads/{id} for new business and /projects/{id} for client projects; opening a deal under the
 * other area moves it to its own address.
 */
export function DealPage({ id, area }: { id: string; area: DealArea }) {
  const router = useRouter();
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const me = useAppSelector((s) => s.auth.session?.profile.id);
  const [deleting, setDeleting] = useState(false);
  const detail = useApi<LeadDetail>(`/leads/${id}`);
  const deal = useApi<DealData>(`/leads/${id}/deal`);
  const reloadAll = () => { void detail.reload(); void deal.reload(); };
  const actions = useLeadActions(reloadAll, detail.data?.lead.ownerId);
  const [editing, setEditing] = useState(false);
  const [noting, setNoting] = useState(false);
  const lead = detail.data?.lead;

  const isProject = lead?.pipeline === "client";
  const wrongArea = !!lead && (isProject ? area !== "projects" : area !== "leads");

  // A client project opened from an old /leads link (a notification, say) moves to /projects, and the other way round.
  useEffect(() => {
    if (wrongArea && lead) router.replace(isProject ? `/projects/${id}` : `/leads/${id}`);
  }, [wrongArea, isProject, id, lead, router]);

  // Breadcrumb in the top bar: Leads › Company, or Projects › Project.
  useEffect(() => {
    if (!lead || wrongArea) return;
    setCrumb({
      path: `/${area}/${id}`,
      parent: isProject ? { href: "/projects", label: "Projects" } : { href: "/leads", label: "Leads" },
      label: isProject && lead.projectTitle ? `${lead.projectTitle} · ${lead.company.name}` : lead.company.name,
    });
    return () => setCrumb(null);
  }, [id, lead, area, isProject, wrongArea]);

  if ((detail.loading && !detail.data) || wrongArea) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!detail.data || !lead) {
    return <StateView kind={detail.error?.includes("find") ? "empty" : "error"} title={detail.error?.includes("find") ? (area === "projects" ? "Project not found" : "Lead not found") : undefined} message={detail.error ?? (area === "projects" ? "We could not find this project." : "We could not find this lead.")} onRetry={() => void detail.reload()} action={<Link href={`/${area}`}><Button variant="secondary">{area === "projects" ? "Back to projects" : "Back to leads"}</Button></Link>} />;
  }

  const { meetings } = detail.data;
  const target = leadTarget(lead);
  const pipeline = lead.pipeline ?? "new_business";
  const closed = lead.stage === "closed_won" || lead.stage === "closed_lost";
  const steps = PIPELINE_STAGES[pipeline] as readonly StageKey[];
  // The agreement card matters from the proposal onwards, or once anything is recorded on it.
  const proposalIndex = pipeline === "client" ? steps.indexOf("project_proposal") : steps.indexOf("quotation_sent");
  const reached = closed || steps.indexOf(lead.stage) >= proposalIndex;
  const showAgreement = reached || !!deal.data?.agreement.sentAt || !!deal.data?.agreement.payment;

  async function updateMeeting(mid: string, status: "done" | "cancelled") {
    try {
      await apiClient.patch(`/meetings/${mid}`, { status });
      reloadAll();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const upcoming = meetings.filter((m) => m.status === "scheduled");
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <LeadHeader
        lead={lead}
        canReassign={!!role && isManager(role)}
        onCall={() => actions.call(target)}
        onWhatsApp={() => actions.whatsapp(target)}
        onMeeting={() => actions.meeting(target)}
        onReminder={() => actions.schedule(target)}
        onEdit={() => setEditing(true)}
        onReassign={() => actions.reassign(target)}
        onNote={() => setNoting(true)}
        canDelete={!!role && (isManager(role) || (role === "sales_executive" && lead.ownerId === me))}
        onDelete={() => setDeleting(true)}
      />
      <DeleteRecordDialog
        open={deleting} kind="lead" path={`/leads/${lead.id}`}
        name={lead.projectTitle && lead.pipeline === "client" ? `${lead.company.name} · ${lead.projectTitle}` : lead.company.name}
        onClose={() => setDeleting(false)}
        onDeleted={() => router.push(lead.pipeline === "client" ? "/projects" : "/leads")}
        onCloseAsLost={() => actions.close(target)}
      />
      <StageProgress stage={lead.stage} pipeline={pipeline} lostFrom={lead.lostFromStage} lostReason={lead.lostReason} onPick={(s) => actions.moveTo(target, s)} onReopen={(s) => actions.reopen(target, s)} onCloseLead={() => actions.close(target)} />
      <MeetingsCard meetings={upcoming} onDone={(m) => updateMeeting(m, "done")} onCancel={(m) => updateMeeting(m, "cancelled")} />

      {/* the deal, two cards side by side on wide screens */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <DealDetailsCard lead={lead} deal={deal.data} onSaved={reloadAll} />
        <MeetingNotesCard deal={deal.data} closed={closed} onAdd={() => actions.minutes(target)} />
        <QuotesCard deal={deal.data} closed={closed} onCreate={() => actions.quotation(target)} onSend={(q) => actions.send(target, q)} />
        {pipeline !== "client" && (reached || !!deal.data?.samples?.items.length) && (
          <SamplesCard deal={deal.data} closed={closed} onOpen={() => actions.sampling(target)} />
        )}
        {showAgreement && (
          <AgreementCard lead={lead} deal={deal.data} closed={closed} onPrepare={() => actions.agreement(target)} onPayment={() => actions.payment(target, deal.data?.agreement.totalAmount ?? deal.data?.value.quoted)} onReload={reloadAll} />
        )}
        {lead.notes && (
          <section className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="mb-1 text-[15px] font-semibold tracking-tight text-slate-900">{isProject ? "Notes from when the project was created" : "Notes from when the lead was added"}</h2>
            <p className="t-body whitespace-pre-wrap text-slate-600">{lead.notes}</p>
          </section>
        )}
      </div>

      <NoteSheet leadId={lead.id} name={lead.company.name} open={noting} onClose={() => setNoting(false)} onSaved={reloadAll} />
      <EditLeadSheet lead={lead} meta={actions.meta ?? undefined} open={editing} onClose={() => setEditing(false)} onSaved={reloadAll} />
      {actions.sheets}
    </div>
  );
}
