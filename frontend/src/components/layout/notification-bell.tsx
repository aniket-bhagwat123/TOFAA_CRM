"use client";
import { AlertTriangle, Bell, CalendarClock, CalendarDays, CheckCheck, ChevronRight, CircleSlash, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useApi } from "@/hooks/use-api";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiClient } from "@/services/api-client";
import type { FollowUpItem, NotificationCenter } from "@/types/crm";

const POLL_MS = 60_000;
const KIND: Record<string, string> = { call: "Call", follow_up: "Follow-up", meeting: "Meeting", whatsapp: "WhatsApp", other: "Task" };
const clock = (iso: string) => formatTime(iso).toUpperCase();
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : formatDate(iso);
};

/**
 * The bell next to the profile. The red number is what needs you now: new alerts + overdue follow-ups + follow-ups
 * still due today. Inside: Upcoming (overdue, today, tomorrow, meetings, new leads, leads with no next step) and Alerts.
 */
export function NotificationBell() {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "alerts">("upcoming");
  const api = useApi<NotificationCenter>("/notifications/center");
  const reload = useRef(api.reload);
  reload.current = api.reload;
  const root = useRef<HTMLDivElement>(null);

  // Fresh numbers: every minute, on every page change, when the window comes back, and when the panel opens.
  useEffect(() => {
    const tick = () => void reload.current();
    const t = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => { clearInterval(t); window.removeEventListener("focus", tick); };
  }, []);
  useEffect(() => { setOpen(false); void reload.current(); }, [path]);
  useEffect(() => { if (open) void reload.current(); }, [open]);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const d = api.data;
  const c = d?.counts;
  const badge = c?.badge ?? 0;
  const upcomingCount = c ? c.overdue + c.today + c.tomorrow + c.meetings + c.newLeads : 0;
  const summary = c ? [c.unread && `${c.unread} new alert${c.unread === 1 ? "" : "s"}`, c.overdue && `${c.overdue} overdue`, c.today && `${c.today} due today`].filter(Boolean).join(" · ") : "";

  const go = (href: string) => { setOpen(false); router.push(href); };
  async function openAlert(id: string, link?: string | null) {
    try { await apiClient.post("/notifications/read", { ids: [id] }); } catch { /* still open it */ }
    void reload.current();
    if (link) go(link);
  }
  async function readAll() {
    try { await apiClient.post("/notifications/read-all", {}); } finally { void reload.current(); }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        aria-label={badge ? `Notifications: ${summary}` : "Notifications"}
        title={summary || "Notifications"}
        className={cn("pressable relative flex h-10 w-10 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100", open && "bg-slate-100 text-brand")}
      >
        <Bell className="h-5 w-5" />
        {badge > 0 && (
          <span aria-hidden="true" className="absolute right-0.5 top-0.5 flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications"
          className="fixed inset-x-2 top-14 z-50 flex max-h-[80vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-float sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[24rem]">
          <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
              <p className="truncate text-xs text-slate-500">{summary || "You're all caught up"}</p>
            </div>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="pressable rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
          </header>

          <div role="tablist" className="flex gap-1 border-b border-slate-100 px-2 pt-1">
            <TabBtn active={tab === "upcoming"} onClick={() => setTab("upcoming")} count={upcomingCount}>Upcoming</TabBtn>
            <TabBtn active={tab === "alerts"} onClick={() => setTab("alerts")} count={c?.unread ?? 0} red>Alerts</TabBtn>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!d ? (
              <p className="p-6 text-center text-sm text-slate-400">Loading…</p>
            ) : tab === "upcoming" ? (
              upcomingCount === 0 && !c?.noNextAction ? (
                <Empty icon={<CheckCheck className="h-6 w-6" />} text="Nothing coming up. You're all caught up." />
              ) : (
                <div className="divide-y divide-slate-100">
                  <FollowUpGroup title="Overdue" tone="red" items={d.overdue} onGo={() => go("/follow-ups")} />
                  <FollowUpGroup title="Due today" tone="brand" items={d.today} onGo={() => go("/follow-ups")} />
                  <FollowUpGroup title="Tomorrow" tone="slate" items={d.tomorrow} onGo={() => go("/follow-ups")} />
                  {d.meetings.length > 0 && (
                    <Group title="Meetings" count={d.meetings.length} icon={<CalendarDays className="h-3.5 w-3.5" />}>
                      {d.meetings.map((m) => (
                        <Row key={m.id} onClick={() => go(`/leads/${m.leadId}`)} title={m.companyName ?? "Meeting"}
                          meta={`${m.kind === "online" ? "Online" : m.location || "Meeting"} · ${m.contactName ?? ""}`}
                          when={`${formatDate(m.startsAt)}, ${clock(m.startsAt)}`} />
                      ))}
                    </Group>
                  )}
                  {d.newLeads.length > 0 && (
                    <Group title="New leads for you" count={d.newLeads.length} icon={<Sparkles className="h-3.5 w-3.5" />}>
                      {d.newLeads.map((l) => (
                        <Row key={l.leadId} onClick={() => go(`/leads/${l.leadId}`)} title={l.companyName ?? "New lead"}
                          meta={`${l.contactName ?? "No contact"}${l.phone ? ` · ${l.phone}` : ""} · not called yet`} when={ago(l.createdAt)} />
                      ))}
                    </Group>
                  )}
                  {(c?.noNextAction ?? 0) > 0 && (
                    <button type="button" onClick={() => { go("/follow-ups?show=none"); window.dispatchEvent(new CustomEvent("followups:show", { detail: "none" })); }} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-amber-50/60">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><CircleSlash className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900">{c!.noNextAction} lead{c!.noNextAction === 1 ? "" : "s"} with no next action</span>
                        <span className="block text-xs text-slate-500">Set a follow-up so none is forgotten</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </button>
                  )}
                </div>
              )
            ) : d.alerts.length === 0 ? (
              <Empty icon={<Bell className="h-6 w-6" />} text="No alerts in the last 7 days." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {d.alerts.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => void openAlert(a.id, a.link)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50", !a.readAt && "bg-brand-soft/30")}>
                      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.readAt ? "bg-transparent" : "bg-brand")} aria-label={a.readAt ? undefined : "Unread"} />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm text-slate-900", !a.readAt && "font-semibold")}>{a.title}</span>
                        {a.body && <span className="mt-0.5 block text-xs text-slate-500">{a.body}</span>}
                        <span className="mt-1 block text-[11px] text-slate-400">{ago(a.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5">
            {tab === "alerts" && (c?.unread ?? 0) > 0 ? (
              <button type="button" onClick={() => void readAll()} className="pressable flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"><CheckCheck className="h-4 w-4" />Mark all as read</button>
            ) : <span />}
            <Link href="/follow-ups" onClick={() => setOpen(false)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-brand hover:bg-brand-soft">Open Follow-ups<ChevronRight className="h-3.5 w-3.5" /></Link>
          </footer>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, count, red, children }: { active: boolean; onClick: () => void; count: number; red?: boolean; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium", active ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800")}>
      {children}
      {count > 0 && <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none", red ? "bg-red-600 text-white" : active ? "bg-brand text-white" : "bg-slate-200 text-slate-700")}>{count}</span>}
    </button>
  );
}

function Group({ title, count, icon, tone = "slate", children }: { title: string; count: number; icon: ReactNode; tone?: "red" | "brand" | "slate"; children: ReactNode }) {
  const color = tone === "red" ? "text-red-600" : tone === "brand" ? "text-brand" : "text-slate-500";
  return (
    <section className="py-1.5">
      <h3 className={cn("flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide", color)}>{icon}{title} · {count}</h3>
      {children}
    </section>
  );
}

function FollowUpGroup({ title, tone, items, onGo }: { title: string; tone: "red" | "brand" | "slate"; items: FollowUpItem[]; onGo: () => void }) {
  if (!items.length) return null;
  const Icon = tone === "red" ? AlertTriangle : CalendarClock;
  return (
    <Group title={title} count={items.length} tone={tone} icon={<Icon className="h-3.5 w-3.5" />}>
      {items.slice(0, 6).map((f) => (
        <Row key={f.id} onClick={onGo} late={tone === "red"}
          title={f.projectTitle ? `${f.companyName} · ${f.projectTitle}` : f.companyName}
          meta={`${KIND[f.meeting ? "meeting" : f.kind] ?? "Follow-up"} · ${f.contactName || "No contact"}${f.clientRequested ? " · Client requested" : ""}`}
          when={f.dueAt ? (tone === "slate" ? `Tomorrow, ${clock(f.dueAt)}` : clock(f.dueAt)) : formatDate(f.dueDate)} />
      ))}
      {items.length > 6 && <button type="button" onClick={onGo} className="px-4 pb-1 text-xs font-medium text-brand hover:underline">+ {items.length - 6} more</button>}
    </Group>
  );
}

function Row({ title, meta, when, onClick, late }: { title: string; meta: string; when: string; onClick: () => void; late?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{title}</span>
        <span className="block truncate text-xs text-slate-500">{meta}</span>
      </span>
      <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", late ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700")}>{when}</span>
    </button>
  );
}

const Empty = ({ icon, text }: { icon: ReactNode; text: string }) => (
  <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-slate-500">
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">{icon}</span>{text}
  </div>
);
