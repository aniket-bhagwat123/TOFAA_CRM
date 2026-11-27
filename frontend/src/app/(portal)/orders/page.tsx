"use client";
import { ArrowRight, Check, ChevronDown, ClipboardCheck, Factory, PackageCheck, Plus, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { StatusConfirm } from "@/components/orders/status-confirm";
import { Button } from "@/components/ui/button";
import { BOARD_TABLE, ViewToggle } from "@/components/ui/view-toggle";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { BoardSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAllPages } from "@/hooks/use-all-pages";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { formatDate } from "@/lib/format";
import { inr } from "@/lib/money";
import { orderStatus } from "@/lib/order-status";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { AssignableUser, Lead } from "@/types/crm";
import type { OrderStatus } from "@/types/orders";

type Step = "production" | "quality_check" | "dispatched" | "delivered";
type Order = Lead & {
  orderId?: string; orderNumber?: string; orderAmount?: number | null; leadId?: string | null;
  deliveryStatus?: OrderStatus | null; deliveryUpdatedAt?: string | null; closedAt?: string | null; paidAmount?: number | null;
};
type OrdersData = { items: Order[]; meta: { page: number; pages: number; total: number }; counts: Partial<Record<OrderStatus, number>>; managed?: boolean };

/** Where an order stands on the four-step tracker: -1 before production. */
const position = (status?: OrderStatus | null) => (status === "packed" ? 1 : STEPS.findIndex((s) => s.key === status));
const orderHref = (o: Order) => `/orders/${o.orderId ?? o.id}`;

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
const VIEW_KEY = "tofaa-orders-layout"; // the table opens first unless the person picks the board
const SELECT = "h-10 w-full shrink-0 truncate rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 sm:w-44";

/** Won deals being delivered: each moves Production -> Quality check -> Dispatched -> Delivered. */
export default function OrdersPage() {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const manager = !!user && isManager(user.role);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ order: Order; step: Step } | null>(null);
  const [layout, setLayout] = useState<"board" | "table">("table");
  const q = useDebounce(search, 300);

  // Start where the person left off.
  useEffect(() => {
    try { const v = localStorage.getItem(VIEW_KEY); if (v === "board" || v === "table") setLayout(v); } catch { /* storage unavailable */ }
  }, []);
  const chooseLayout = (v: "board" | "table") => {
    setLayout(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  };
  const list = useAllPages<OrdersData>("/orders", { search: q || undefined, status: status || undefined, ownerId: owner || undefined });
  const people = useApi<AssignableUser[]>(manager ? "/users/assignable" : null);
  const reset = (fn: () => void) => fn();
  const counts = list.data?.counts;
  const stages: OrderStatus[] = list.data?.managed
    ? ["new", "ready", "accepted", "production", "quality_check", "packed", "dispatched", "delivered", "on_hold", "rejected", "cancelled"]
    : ["new", ...STEPS.map((s) => s.key)];
  const total = counts ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) : undefined;

  async function move(o: Order, step: Step, note?: string) {
    setBusy(o.id);
    try {
      const body = { status: step, note: note?.trim() || null };
      await (list.data?.managed ? apiClient.post(`/orders/by-id/${o.orderId}/status`, body) : apiClient.patch(`/orders/${o.id}`, body));
      toast.success(`${o.orderNumber ? `#${o.orderNumber}` : o.company.name}: ${STEPS.find((s) => s.key === step)?.label}`);
      setConfirm(null);
      void list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

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
        <select className={SELECT} value={status} onChange={(e) => reset(() => setStatus(e.target.value))} aria-label="Stage">
          <option value="">All stages{total != null ? ` (${total})` : ""}</option>
          {stages.map((s) => <option key={s} value={s}>{STEPS.find((x) => x.key === s)?.label ?? orderStatus(s).label}{counts?.[s] != null ? ` (${counts[s]})` : ""}</option>)}
        </select>
        <ViewToggle value={layout} onChange={chooseLayout} options={BOARD_TABLE} className="ml-auto" />
        {list.data?.managed && <Link href="/orders/new" className="pressable inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark"><Plus className="h-4 w-4" />Create order</Link>}
      </div>
      {list.loading && !list.data && (layout === "board" ? <BoardSkeleton /> : <TableSkeleton columns={7} rows={8} />)}
      {list.error && !list.data && <StateView kind="error" message={list.error} onRetry={() => void list.reload()} />}
      {list.data && list.data.items.length === 0 && <StateView kind="empty" title="No orders" message={q || status || owner ? "Try a different search or filter." : "A deal becomes an order when its payment is confirmed (Closed Won)."} />}

      {layout === "board" ? (
        <ul className="space-y-3">
          {list.data?.items.map((o) => <OrderCard key={o.id} o={o} busy={busy === o.id} onMove={(step) => setConfirm({ order: o, step })} />)}
        </ul>
      ) : (
        !!list.data?.items.length && <OrdersTable orders={list.data.items} busyId={busy} onMove={(o, step) => setConfirm({ order: o, step })} />
      )}
      <StatusConfirm
        target={confirm && { from: confirm.order.deliveryStatus ?? "new", to: confirm.step, orderNumber: confirm.order.orderNumber, company: confirm.order.company.name }}
        busy={!!confirm && busy === confirm.order.id}
        onCancel={() => setConfirm(null)}
        onConfirm={(note) => confirm && void move(confirm.order, confirm.step, note)}
      />
    </div>
  );
}

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
  const router = useRouter();
  const at = position(o.deliveryStatus);
  const stopped = o.deliveryStatus === "cancelled" || o.deliveryStatus === "on_hold" || o.deliveryStatus === "rejected";
  const next = stopped ? undefined : STEPS[at + 1];
  const status = orderStatus(o.deliveryStatus);
  const delivered = o.deliveryStatus === "delivered";
  const fill = at <= 0 ? 0 : (at / (STEPS.length - 1)) * 100;

  return (
    // The whole card opens the order; its buttons and links keep their own job.
    <li onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) router.push(orderHref(o)); }}
      className="cursor-pointer rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card transition-shadow hover:shadow-float sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={o.contact.photoUrl} name={o.company.name} size="md" square />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={orderHref(o)} className="truncate font-semibold text-slate-900 hover:text-brand">{o.company.name}</Link>
              <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", status.tone)}>{status.label}</span>
              {o.orderNumber && <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-sm font-bold text-slate-800">#{o.orderNumber}</span>}
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
                <span className={cn("text-[12px] font-medium leading-tight sm:text-xs", done ? s.text : current ? "text-slate-900" : "text-slate-400")}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* the one action: the next step */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-500">
          {delivered ? "Delivered to the client. This order is complete." : next ? <>Next step: <b className="font-semibold text-slate-700">{next.label}</b></> : stopped ? "Open the order to see why and what next." : null}
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
  const value: OrderStatus = o.deliveryStatus ?? "new";
  if (value === "cancelled") return <span className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", orderStatus(value).tone)}>{orderStatus(value).label}</span>;
  return (
    <span className={cn("relative inline-flex items-center rounded-full", orderStatus(value).tone, busy && "opacity-60")}>
      <select
        aria-label={`Delivery step for ${o.company.name}`}
        value={value}
        disabled={busy}
        onChange={(e) => onMove(e.target.value as Step)}
        className="h-8 cursor-pointer appearance-none rounded-full bg-transparent py-1 pl-3 pr-8 text-xs font-semibold outline-none focus:ring-2 focus:ring-brand/30"
      >
        {!STEPS.some((s) => s.key === value) && <option value={value} disabled>{orderStatus(value).label}</option>}
        {STEPS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}

/** Orders as rows: order number, who, value, when won, and the step as a colour-coded dropdown. */
function OrdersTable({ orders, busyId, onMove }: { orders: Order[]; busyId: string | null; onMove: (o: Order, step: Step) => void }) {
  const router = useRouter();
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <Table>
        <TableHeader className="bg-slate-50/80">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Order ID</TableHead>
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
            <TableRow key={o.id} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,select")) router.push(orderHref(o)); }}>
              <TableCell className="pl-4 font-mono text-[0.9375rem] font-bold text-slate-900">{o.orderNumber ? `#${o.orderNumber}` : "—"}</TableCell>
              <TableCell>
                <div className="flex max-w-[18rem] items-center gap-3">
                  <Avatar src={o.contact.photoUrl} name={o.company.name} size="sm" square />
                  <div className="min-w-0">
                    <Link href={orderHref(o)} className="block truncate font-semibold text-slate-900 hover:text-brand">{o.company.name}</Link>
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
