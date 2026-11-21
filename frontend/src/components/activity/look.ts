import { ArrowLeftRight, Building2, CalendarDays, CheckCircle2, FileSignature, FileText, FileUp, Megaphone, MessageCircle, NotebookPen, Phone, Plus, StickyNote, UserCog, UserRound, Wallet } from "lucide-react";
import type { Activity } from "@/types/crm";

/** The icon and colour for each kind of activity, shared by every list that shows them. */
export function activityLook(a: Activity): { icon: typeof Phone; tone: string } {
  const sent = a.outcome === "sent" || a.outcome === "confirmed";
  switch (a.kind) {
    case "meeting": return a.outcome === "done" ? { icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-600" } : { icon: CalendarDays, tone: "bg-violet-100 text-violet-600" };
    case "whatsapp": return { icon: MessageCircle, tone: "bg-emerald-100 text-emerald-600" };
    case "call": return { icon: Phone, tone: "bg-violet-100 text-violet-600" };
    case "stage_change": return { icon: a.meta?.to === "connected" ? UserRound : ArrowLeftRight, tone: "bg-violet-100 text-violet-600" };
    case "note": return { icon: StickyNote, tone: "bg-amber-100 text-amber-600" };
    case "mom": return { icon: NotebookPen, tone: "bg-indigo-100 text-indigo-600" };
    case "quotation": return { icon: FileText, tone: sent ? "bg-sky-100 text-sky-600" : "bg-violet-100 text-violet-600" };
    case "agreement": return { icon: FileSignature, tone: "bg-amber-100 text-amber-600" };
    case "payment": return { icon: Wallet, tone: "bg-emerald-100 text-emerald-600" };
    case "reassign": return { icon: UserCog, tone: "bg-sky-100 text-sky-600" };
    case "task": return { icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-600" };
    case "client": return { icon: Building2, tone: "bg-violet-100 text-violet-600" };
    case "campaign": return { icon: Megaphone, tone: "bg-violet-100 text-violet-600" };
    case "import": return { icon: FileUp, tone: "bg-slate-100 text-slate-500" };
    default: return { icon: Plus, tone: "bg-violet-100 text-violet-600" };
  }
}
