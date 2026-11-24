"use client";
import { ArrowRight, Check, ChevronDown, ClipboardCheck, Columns3, Factory, PackageCheck, Table2, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { formatDate } from "@/lib/format";
import { inr } from "@/lib/money";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { AssignableUser, Lead } from "@/types/crm";

type Step = "production" | "quality_check" | "dispatched" | "delivered";
type Order = Lead & {
  orderId?: string; orderNumber?: string; orderAmount?: number | null;
  deliveryStatus?: Step | null; deliveryUpdatedAt?: string | null; closedAt?: string | null; paidAmount?: number | null;
};
type OrdersData = { items: Order[]; meta: { page: number; pages: number; total: number }; counts: Record<"new" | Step, number> };

// Every step looks the same once done: filled and bordered in the step blue rgb(34 115 166), keeping its own icon
// (and a green tick in the corner). The line between the steps fills in the same blue.
// (Written out in full: Tailwind only generates classes it can see as plain text.)
const DONE = { done: "border-[rgb(34_115_166)] bg-[rgb(34_115_166)]", text: "text-violet-700" };
const STEPS: { key: Step; label: string; icon: typeof Factory; done: string; text: string }[] = [
  { key: "production", label: "Production", icon: Factory, ...DONE },
  { key: "quality_check", label: "Quality check", icon: ClipboardCheck, ...DONE },
  { key: "dispatched", label: "Dispatched", icon: Truck, ...DONE },
  { key: "delivered", label: "Delivered", icon: PackageCheck, ...DONE },
];
const VIEW_KEY = "tofaa-orders-view";
const SELECT = "h-10 w-full shrink-0 truncate rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 sm:w-44";

/** Won deals being delivered: each moves Production -> Quality check -> Dispatched -> Delivered. */
export default function OrdersPage() {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const manager = !!user && isManager(user.role);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ order: Order; step: Step } | null>(null);
  const [layout, setLayout] = useState<"board" | "table">("board");
  const q = useDebounce(search, 300);

  // Start where the person left off.
  useEffect(() => {
    try { const v = localStorage.getItem(VIEW_KEY); if (v === "board" || v === "table") setLayout(v); } catch { /* storage unavailable */ }
  }, []);
  const chooseLayout = (v: "board" | "table") => {
    setLayout(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  };
  const list = useApi<OrdersData>("/orders", { search: q || undefined, status: status || undefined, ownerId: owner || undefined, page, limit: 20 });
  const people = useApi<AssignableUser[]>(manager ? "/users/assignable" : null);
  const reset = (fn: () => void) => { fn(); setPage(1); };
  const counts = list.data?.counts;

  async function move(o: Order, step: Step, note?: string) {
    setBusy(o.id);
    try {
      await apiClient.patch(`/orders/${o.id}`, { status: step, note: note?.trim() || null });
      toast.success(`${o.orderNumber ?? o.company.name}: ${STEPS.find((s) => s.key === step)?.label}`);
      setConfirm(null);
      void list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const chip = (value: string, label: string, n?: number) => (
    <button key={value} type="button" aria-pressed={status === value} onClick={() => reset(() => setStatus(value))}
      className={cn("pressable inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium", status === value ? "border-brand bg-brand text-white" : "border-slate-300/80 bg-white text-slate-600 hover:border-slate-400")}>
      {label}{n != null && <span className={cn("rounded-full px-1.5 text-xs", status === value ? "bg-white/20" : "bg-slate-100")}>{n}</span>}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="sm:w-64" value={search} onChange={(v) => reset(() => setSearch(v))} placeholder="Search company or contact" />
        {manager && (
          <select className={SELECT} value={owner} onChange={(e) => reset(() => setOwner(e.target.value))} aria-label="Owner">
            <option value="">Whole team</option>
            {people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        )}
        <div className="ml-auto flex h-10 shrink-0 items-center gap-0.5 rounded-xl border border-slate-300/80 bg-white p-1" role="radiogroup" aria-label="Layout">
          {([["board", "Board view", Columns3], ["table", "Table view", Table2]] as const).map(([v, label, Icon]) => (
            <Tooltip key={v} label={label}>
              <button
                type="button"
                role="radio"
                aria-checked={layout === v}
                aria-label={label}
                onClick={() => chooseLayout(v)}
                className={cn("pressable flex h-8 w-8 items-center justify-center rounded-lg", layout === v ? "bg-brand-soft text-brand" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")}
              >
                <Icon className="h-4 w-4" />
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {chip("", "All", counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined)}
        {chip("new", "Not started", counts?.new)}
        {STEPS.map((s) => chip(s.key, s.label, counts?.[s.key]))}
      </div>

      {list.loading && !list.data && <div className="flex justify-center py-12"><Spinner /></div>}
      {list.error && !list.data && <StateView kind="error" message={list.error} onRetry={() => void list.reload()} />}
      {list.data && list.data.items.length === 0 && <StateView kind="empty" title="No orders" message={q || status || owner ? "Try a different search or filter." : "A deal becomes an order when its payment is confirmed (Closed Won)."} />}

      {layout === "board" ? (
        <ul className="space-y-3">
          {list.data?.items.map((o) => <OrderCard key={o.id} o={o} busy={busy === o.id} onMove={(step) => setConfirm({ order: o, step })} />)}
        </ul>
      ) : (
        !!list.data?.items.length && <OrdersTable orders={list.data.items} busyId={busy} onMove={(o, step) => setConfirm({ order: o, step })} />
      )}
      {list.data && list.data.meta.pages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {list.data.meta.pages} · {list.data.meta.total} orders</span>
          <Button variant="secondary" disabled={page >= list.data.meta.pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      <ConfirmStep
        target={confirm}
        busy={!!confirm && busy === confirm.order.id}
        onCancel={() => setConfirm(null)}
        onConfirm={(note) => confirm && void move(confirm.order, confirm.step, note)}
      />
    </div>
  );
}

// The big icon colour in the confirmation, per step.
const STEP_TONE: Record<Step, string> = {
  production: "bg-amber-100 text-amber-600 ring-amber-50",
  quality_check: "bg-violet-100 text-violet-600 ring-violet-50",
  dispatched: "bg-sky-100 text-sky-600 ring-sky-50",
  delivered: "bg-emerald-100 text-emerald-600 ring-emerald-50",
};

/** A small "Are you sure?" before an order moves: the step's icon, one question, No / Yes. */
function ConfirmStep({ target, busy, onCancel, onConfirm }: { target: { order: Order; step: Step } | null; busy: boolean; onCancel: () => void; onConfirm: (note: string) => void }) {
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, busy, onCancel]);
  if (!target) return null;
  const step = STEPS.find((s) => s.key === target.step)!;
  const Icon = step.icon;
  const from = target.order.deliveryStatus ? STEPS.findIndex((s) => s.key === target.order.deliveryStatus) : -1;
  // Drawn on <body>, so the overlay covers the whole screen whatever the page layout around it does.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex h-dvh w-screen items-center justify-center bg-slate-900/40 p-4" onClick={() => !busy && onCancel()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-step-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-5 rounded-3xl bg-white p-6 text-center shadow-sheet">
        <span className={cn("mx-auto flex h-14 w-14 items-center justify-center rounded-full ring-8", STEP_TONE[target.step])}>
          <Icon className="h-7 w-7" />
        </span>

        <div className="space-y-2">
          <p id="confirm-step-title" className="text-base font-semibold text-slate-900">Move this order to {step.label}?</p>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
            {target.order.orderNumber && <span className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 font-mono font-semibold text-slate-700">{target.order.orderNumber}</span>}
            <span className="truncate">{target.order.company.name}</span>
          </div>
        </div>

        {/* just the two steps: where the order is now, and where it goes */}
        <div className="flex items-center justify-center gap-3" aria-label="Step change">
          {(() => {
            const fromStep = from >= 0 ? STEPS[from] : null;
            const FromIcon = fromStep?.icon ?? Factory;
            return (
              <div className="flex w-24 flex-col items-center gap-1.5">
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-full text-white", fromStep ? "bg-[rgb(34_115_166)]" : "bg-slate-300")}>
                  <FromIcon className="h-4 w-4" />
                </span>
                <span className="text-xs font-medium text-slate-500">{fromStep?.label ?? "Not started"}</span>
              </div>
            );
          })()}
          <ArrowRight className="mb-5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="flex w-24 flex-col items-center gap-1.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white ring-4 ring-brand/20">
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-slate-900">{step.label}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>No</Button>
          <Button onClick={() => onConfirm("")} loading={busy}>Yes</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// What each step means in one short line: shown on the status pill and in the table dropdown.
const STATUS_TEXT: Record<"new" | Step, { pill: string; tone: string }> = {
  new: { pill: "Not started", tone: "bg-slate-100 text-slate-600" },
  production: { pill: "In production", tone: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200" },
  quality_check: { pill: "In quality check", tone: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200" },
  dispatched: { pill: "Dispatched", tone: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200" },
  delivered: { pill: "Delivered", tone: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200" },
};
const ACTION: Record<Step, string> = {
  production: "Start production",
  quality_check: "Move to quality check",
  dispatched: "Mark as dispatched",
  delivered: "Mark as delivered",
};

/**
 * One order: who and how much, a progress tracker (steps reached are filled with a green tick in the corner, the
 * current one ringed, the rest grey, joined by a line that fills as it moves), and a single button for the next step.
 */
function OrderCard({ o, busy, onMove }: { o: Order; busy: boolean; onMove: (step: Step) => void }) {
  const at = o.deliveryStatus ? STEPS.findIndex((s) => s.key === o.deliveryStatus) : -1;
  const next = STEPS[at + 1];
  const status = STATUS_TEXT[o.deliveryStatus ?? "new"];
  const delivered = o.deliveryStatus === "delivered";
  const fill = at <= 0 ? 0 : (at / (STEPS.length - 1)) * 100;

  return (
    <li className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={o.contact.photoUrl} name={o.company.name} size="md" square />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={o.pipeline === "client" ? `/projects/${o.id}` : `/leads/${o.id}`} className="truncate font-semibold text-slate-900 hover:text-brand">{o.company.name}</Link>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", status.tone)}>{status.pill}</span>
              {o.orderNumber && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600">{o.orderNumber}</span>}
            </div>
            <div className="truncate text-xs text-slate-500">
              {o.contact.name}{o.owner?.fullName ? ` · ${o.owner.fullName}` : ""}{o.closedAt ? ` · won ${formatDate(o.closedAt)}` : ""}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-semibold tabular-nums text-slate-900">{inr(o.orderAmount ?? o.paidAmount ?? o.dealValue ?? 0)}</div>
          <div className="text-xs text-slate-400">{o.deliveryUpdatedAt ? `Updated ${formatDate(o.deliveryUpdatedAt)}` : "Waiting to start"}</div>
        </div>
      </div>

      {/* progress tracker */}
      <div className="relative mt-5 px-1">
        <div className="absolute left-[12.5%] right-[12.5%] top-4 h-0.5 rounded-full bg-slate-200" aria-hidden="true">
          <div className="h-full rounded-full bg-[rgb(34_115_166)] transition-all duration-500" style={{ width: `${fill}%` }} />
        </div>
        <ol className="relative grid grid-cols-4" aria-label="Delivery progress">
          {STEPS.map((s, i) => {
            const done = i < at || (delivered && i === at);
            const current = i === at && !delivered;
            const Icon = s.icon;
            return (
              <li key={s.key} className="flex flex-col items-center gap-1.5 text-center" aria-current={current ? "step" : undefined}>
                <span
                  className={cn(
                    "relative flex h-8 w-8 items-center justify-center rounded-full border-2 text-white transition-colors",
                    done && s.done,
                    current && "border-brand bg-brand ring-4 ring-brand/15",
                    !done && !current && "border-slate-300 bg-slate-300",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {/* a step that has been reached (done, or the current one) keeps its icon and gets a green tick in the corner */}
                  {(done || current) && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white" aria-label="Done">
                      <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} />
                    </span>
                  )}
                </span>
                <span className={cn("text-[11px] font-medium leading-tight sm:text-xs", done ? s.text : current ? "text-slate-900" : "text-slate-400")}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* the one action: the next step */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-500">
          {delivered ? "Delivered to the client. This order is complete." : next ? <>Next step: <b className="font-semibold text-slate-700">{next.label}</b></> : null}
        </p>
        {delivered ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><PackageCheck className="h-4 w-4" /> Completed</span>
        ) : next ? (
          <Button className="min-h-9 px-4 py-1.5 text-sm" loading={busy} onClick={() => onMove(next.key)}>
            {ACTION[next.key]} <ArrowRight className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** The step as a colour-coded dropdown: pick any step (it asks to confirm first). */
function StepSelect({ o, busy, onMove }: { o: Order; busy: boolean; onMove: (step: Step) => void }) {
  const value = o.deliveryStatus ?? "new";
  return (
    <span className={cn("relative inline-flex items-center rounded-full", STATUS_TEXT[value].tone, busy && "opacity-60")}>
      <select
        aria-label={`Delivery step for ${o.company.name}`}
        value={value}
        disabled={busy}
        onChange={(e) => onMove(e.target.value as Step)}
        className="h-8 cursor-pointer appearance-none rounded-full bg-transparent py-1 pl-3 pr-8 text-xs font-semibold outline-none focus:ring-2 focus:ring-brand/30"
      >
        {value === "new" && <option value="new" disabled>Not started</option>}
        {STEPS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}

/** Orders as rows: order number, who, value, when won, and the step as a colour-coded dropdown. */
function OrdersTable({ orders, busyId, onMove }: { orders: Order[]; busyId: string | null; onMove: (o: Order, step: Step) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <Table>
        <TableHeader className="bg-slate-50/80">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Order</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Won</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead>Step</TableHead>
            <TableHead className="pr-4">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o.id}>
              <TableCell className="pl-4 font-mono text-xs font-semibold text-slate-700">{o.orderNumber ?? "—"}</TableCell>
              <TableCell>
                <div className="flex max-w-[18rem] items-center gap-3">
                  <Avatar src={o.contact.photoUrl} name={o.company.name} size="sm" square />
                  <div className="min-w-0">
                    <Link href={o.pipeline === "client" ? `/projects/${o.id}` : `/leads/${o.id}`} className="block truncate font-semibold text-slate-900 hover:text-brand">{o.company.name}</Link>
                    <div className="truncate text-xs text-slate-500">{o.contact.name}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-sm text-slate-600">{o.owner?.fullName ?? "—"}</TableCell>
              <TableCell className="text-sm text-slate-600">{o.closedAt ? formatDate(o.closedAt) : "—"}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{inr(o.orderAmount ?? o.paidAmount ?? o.dealValue ?? 0)}</TableCell>
              <TableCell><StepSelect o={o} busy={busyId === o.id} onMove={(step) => onMove(o, step)} /></TableCell>
              <TableCell className="pr-4 text-sm text-slate-500">{o.deliveryUpdatedAt ? formatDate(o.deliveryUpdatedAt) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
