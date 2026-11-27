import { Building2, CalendarDays, Gift, History, Users, Wallet, type LucideIcon } from "lucide-react";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActivityEntry } from "@/types/os-modules";

/** One icon and soft tint per kind of change, as on Gifting OS. */
export const ACTIVITY_KINDS: Record<string, { label: string; Icon: LucideIcon; tint: string }> = {
  requests: { label: "Gift requests", Icon: Gift, tint: "bg-rose-50 text-rose-600" },
  budget: { label: "Budget", Icon: Wallet, tint: "bg-emerald-50 text-emerald-700" },
  people: { label: "Recipients & groups", Icon: Users, tint: "bg-sky-50 text-sky-700" },
  occasions: { label: "Occasions & events", Icon: CalendarDays, tint: "bg-amber-50 text-amber-700" },
  account: { label: "Account & team", Icon: Building2, tint: "bg-indigo-50 text-indigo-700" },
};

export function ActivityRows({ items }: { items: ActivityEntry[] }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80 bg-white shadow-card">
      {items.map((a) => {
        const kind = ACTIVITY_KINDS[a.category] ?? { label: "Other", Icon: History, tint: "bg-slate-100 text-slate-600" };
        return (
          <li key={a.id} className="flex items-start gap-3 px-4 py-3">
            <span aria-hidden="true" className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", kind.tint)}><kind.Icon className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{a.title}</p>
              {a.description && <p className="text-sm text-slate-600">{a.description}</p>}
              <p className="mt-0.5 text-xs text-slate-500">{a.accountName && <b className="font-semibold text-slate-700">{a.accountName} · </b>}By {a.actorName} · {formatDate(a.changedAt)}, {formatTime(a.changedAt)} · {kind.label}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
