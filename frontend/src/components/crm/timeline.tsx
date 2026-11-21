import { ArrowRightLeft, Building2, CalendarDays, CheckCircle2, FileSignature, FileText, FileUp, Megaphone, MessageCircle, NotebookPen, Phone, Plus, StickyNote, UserCog, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { formatDateTime, OUTCOME_LABEL, STAGE_LABEL } from "@/lib/format";
import type { Activity, StageKey } from "@/types/crm";

const ICON: Record<Activity["kind"], ReactNode> = {
  created: <Plus className="h-4 w-4" />,
  call: <Phone className="h-4 w-4" />,
  whatsapp: <MessageCircle className="h-4 w-4" />,
  meeting: <CalendarDays className="h-4 w-4" />,
  note: <StickyNote className="h-4 w-4" />,
  stage_change: <ArrowRightLeft className="h-4 w-4" />,
  reassign: <UserCog className="h-4 w-4" />,
  task: <CheckCircle2 className="h-4 w-4" />,
  import: <FileUp className="h-4 w-4" />,
  mom: <NotebookPen className="h-4 w-4" />,
  quotation: <FileText className="h-4 w-4" />,
  agreement: <FileSignature className="h-4 w-4" />,
  payment: <Wallet className="h-4 w-4" />,
  client: <Building2 className="h-4 w-4" />,
  campaign: <Megaphone className="h-4 w-4" />,
};

export function activityTitle(a: Activity): string {
  const m = a.meta as Record<string, string | boolean | undefined>;
  switch (a.kind) {
    case "call": return `Call · ${OUTCOME_LABEL[a.outcome ?? ""] ?? a.outcome}`;
    case "whatsapp": return m.direction === "in" ? "WhatsApp reply received" : "WhatsApp sent";
    case "meeting": return `Meeting ${a.outcome ?? ""}`.trim();
    case "note": return "Note";
    case "stage_change": return `${STAGE_LABEL[m.from as StageKey] ?? ""} → ${STAGE_LABEL[m.to as StageKey] ?? ""}${m.auto ? " (automatic)" : ""}`;
    case "reassign": return `Reassigned to ${m.toName ?? "another owner"}`;
    case "task": return "Follow-up completed";
    case "created": return "Created";
    case "mom": return "Minutes of meeting";
    case "quotation": return `Quotation ${a.outcome === "sent" ? "sent" : a.outcome === "pending_approval" ? "waiting for approval" : a.outcome ?? ""}`.trim();
    case "agreement": return a.outcome === "signed" ? "Agreement signed" : "Agreement sent";
    case "payment": return a.outcome === "confirmed" ? "Payment received" : a.outcome === "partial" ? "Partial payment" : "Payment requested";
    case "client": return a.outcome === "converted" ? "Became a client" : a.outcome === "project" ? "New project" : a.outcome === "occasion" ? "Occasion added" : a.outcome === "contact" ? "Contact added" : "Client";
    case "campaign": return "Campaign";
    default: return "Imported";
  }
}

export function Timeline({ items }: { items: Activity[] }) {
  if (!items.length) return <p className="text-xs text-slate-500">No activity yet.</p>;
  return (
    <ol className="space-y-3.5">
      {items.map((a) => (
        <li key={a.id} className="flex gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 [&_svg]:h-3.5 [&_svg]:w-3.5">{ICON[a.kind]}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-snug text-slate-800">{activityTitle(a)}</div>
            {a.note && a.kind !== "created" && <p className="whitespace-pre-wrap break-words text-xs leading-snug text-slate-600">{a.note}</p>}
            <div className="text-[11px] text-slate-400">{a.actor?.fullName ?? (a.meta?.direction === "in" ? "Client" : "System")} · {formatDateTime(a.createdAt)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
