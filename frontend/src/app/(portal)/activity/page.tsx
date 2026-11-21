"use client";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { activityLook } from "@/components/activity/look";
import { activityTitle } from "@/components/crm/timeline";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { formatTime } from "@/lib/format";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { Activity, AssignableUser } from "@/types/crm";

type Subject = { type: "lead" | "client"; id: string; name: string; projectTitle?: string | null; pipeline?: string | null };
type FeedItem = Activity & { subject?: Subject | null };
type Feed = { items: FeedItem[]; nextBefore: string | null };

const KINDS: [string, string][] = [
  ["", "All"],
  ["call", "Calls"],
  ["whatsapp", "WhatsApp"],
  ["meeting", "Meetings"],
  ["note", "Notes"],
  ["stage_change", "Stage moves"],
  ["quotation", "Quotations"],
  ["payment", "Payments"],
];
const IST = "Asia/Kolkata";
const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date(iso));
const select = "h-10 w-full shrink-0 truncate rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 sm:w-44";

function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 864e5).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short", year: key.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" }).format(new Date(`${key}T12:00:00+05:30`));
}

/** Everything that happened on the deals and clients you can see, newest first. One lead's history via ?lead=. */
function ActivityFeed() {
  const router = useRouter();
  const params = useSearchParams();
  const leadId = params.get("lead") ?? undefined;
  const companyId = params.get("client") ?? undefined;
  const user = useAppSelector((s) => s.auth.session?.profile);
  const manager = !!user && isManager(user.role);

  const [kind, setKind] = useState("");
  const [owner, setOwner] = useState("");
  const [more, setMore] = useState<FeedItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const query = { kind: kind || undefined, ownerId: owner || undefined, leadId, companyId };
  const first = useApi<Feed>("/activity", query);
  const people = useApi<AssignableUser[]>(manager ? "/users/assignable" : null);

  // A new first page (filters changed, or a refresh) starts the list again.
  useEffect(() => {
    setMore([]);
    setNext(first.data?.nextBefore ?? null);
  }, [first.data]);

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const { data } = await apiClient.get<Feed>("/activity", { params: { ...query, before: next } });
      setMore((m) => [...m, ...data.items]);
      setNext(data.nextBefore);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const items = useMemo(() => [...(first.data?.items ?? []), ...more], [first.data, more]);
  const days = useMemo(() => {
    const groups: { key: string; items: FeedItem[] }[] = [];
    for (const a of items) {
      const key = dayKey(a.createdAt);
      if (groups.at(-1)?.key === key) groups.at(-1)!.items.push(a);
      else groups.push({ key, items: [a] });
    }
    return groups;
  }, [items]);

  const scoped = leadId || companyId;
  const scopeName = items[0]?.subject ? subjectName(items[0].subject) : leadId ? "this lead" : "this client";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader title="Activity" />

      {scoped && (
        <div className="flex min-w-0 items-center gap-2 self-start rounded-full bg-brand-soft py-1.5 pl-4 pr-1.5 text-sm text-brand">
          <span className="truncate">Showing <span className="font-semibold">{scopeName}</span></span>
          <button type="button" onClick={() => router.replace("/activity")} aria-label="Show all activity" className="pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-white/70">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* type chips on the left, owner on the right */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-0.5">
          {KINDS.map(([value, label]) => (
            <button
              key={value || "all"}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={cn("pressable h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium", kind === value ? "border-brand bg-brand text-white" : "border-slate-300/80 bg-white text-slate-600 hover:border-slate-400")}
            >
              {label}
            </button>
          ))}
        </div>
        {manager && !scoped && user && (
          <select className={select} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
            <option value="">Whole team</option>
            <option value={user.id}>Mine</option>
            {people.data?.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        )}
      </div>

      {first.loading && !first.data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : first.error && !first.data ? (
        <StateView kind="error" message={first.error} onRetry={() => void first.reload()} />
      ) : items.length === 0 ? (
        <StateView kind="empty" title="Nothing here yet" message={kind || owner ? "Try a different filter." : "Calls, meetings, notes and stage moves will show up here."} />
      ) : (
        <div className="space-y-5">
          {days.map((d) => (
            <section key={d.key} className="rounded-3xl border border-slate-200/80 bg-white shadow-card">
              <h2 className="t-caption sticky top-0 rounded-t-3xl border-b border-slate-100 bg-white/95 px-5 py-2.5 font-semibold uppercase tracking-wide text-slate-500 backdrop-blur">{dayLabel(d.key)}</h2>
              <ol className="divide-y divide-slate-100">
                {d.items.map((a) => <Row key={a.id} a={a} showSubject={!leadId} />)}
              </ol>
            </section>
          ))}
          {next && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={loadMore} loading={loadingMore}>Load more</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function subjectName(s: Subject): string {
  return s.type === "lead" && s.pipeline === "client" && s.projectTitle ? `${s.name} · ${s.projectTitle}` : s.name;
}

function Row({ a, showSubject }: { a: FeedItem; showSubject: boolean }) {
  const { icon: Icon, tone } = activityLook(a);
  const href = a.subject ? (a.subject.type === "lead" ? (a.subject.pipeline === "client" ? `/projects/${a.subject.id}` : `/leads/${a.subject.id}`) : `/clients/${a.subject.id}`) : null;
  return (
    <li className="flex items-start gap-3.5 px-5 py-3.5">
      <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", tone)}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <p className="t-body min-w-0 truncate font-semibold text-slate-900">{activityTitle(a)}</p>
          <time className="t-meta shrink-0 whitespace-nowrap" dateTime={a.createdAt}>{formatTime(a.createdAt)}</time>
        </div>
        {showSubject && a.subject && href && (
          <Link href={href} className="t-meta block truncate font-medium text-brand hover:underline">{subjectName(a.subject)}</Link>
        )}
        {a.note && <p className="t-body mt-1 line-clamp-3 whitespace-pre-wrap break-words text-slate-600">{a.note}</p>}
        {a.actor?.fullName && <p className="t-meta mt-1 truncate">by {a.actor.fullName}</p>}
      </div>
    </li>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Spinner /></div>}>
      <ActivityFeed />
    </Suspense>
  );
}
