"use client";
/** One order in full: items with GST and totals, payment, delivery, shipment, stage and history. */
import { Building2, Check, ChevronLeft, ExternalLink, History, IndianRupee, MapPin, Pencil, ShoppingBag, StickyNote, Trash2, Truck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { OrderForm } from "@/components/orders/order-form";
import { StatusConfirm } from "@/components/orders/status-confirm";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDelete } from "@/components/ui/use-delete";
import { useApi } from "@/hooks/use-api";
import { formatDate, formatTime } from "@/lib/format";
import { inr } from "@/lib/money";
import { ORDER_FLOW, orderStatus } from "@/lib/order-status";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { OrderDetail, OrderStatus } from "@/types/orders";

const Pill = ({ status }: { status: OrderStatus }) => <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", orderStatus(status).tone)}>{orderStatus(status).label}</span>;
const when = (value: string) => `${formatDate(value)}, ${formatTime(value).toUpperCase()}`;

// Each section: its icon, and the tint of its header and icon.
const SECTION = {
  items: { icon: ShoppingBag, band: "bg-brand-soft", chip: "bg-brand text-white" },
  client: { icon: Building2, band: "bg-sky-50", chip: "bg-sky-600 text-white" },
  payment: { icon: IndianRupee, band: "bg-emerald-50", chip: "bg-emerald-600 text-white" },
  delivery: { icon: MapPin, band: "bg-amber-50", chip: "bg-amber-500 text-white" },
  shipment: { icon: Truck, band: "bg-indigo-50", chip: "bg-indigo-600 text-white" },
  notes: { icon: StickyNote, band: "bg-orange-50", chip: "bg-orange-500 text-white" },
  history: { icon: History, band: "bg-slate-100", chip: "bg-slate-600 text-white" },
};

function Heading({ kind, title }: { kind: keyof typeof SECTION; title: string }) {
  const { icon: Icon, band, chip } = SECTION[kind];
  return (
    <div className={cn("flex items-center gap-2.5 border-b border-slate-200/70 px-4 py-3", band)}>
      <span aria-hidden="true" className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", chip)}><Icon className="h-4 w-4" /></span>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
    </div>
  );
}
function Panel({ kind, title, children }: { kind: keyof typeof SECTION; title: string; children: ReactNode }) {
  return <Card className="overflow-hidden p-0"><Heading kind={kind} title={title} /><div className="space-y-2.5 p-4">{children}</div></Card>;
}
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="space-y-2 text-sm">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="shrink-0 text-slate-500">{label}</dt><dd className="min-w-0 whitespace-pre-line break-words text-right font-medium text-slate-900">{value || "—"}</dd></div>)}</dl>;
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const api = useApi<OrderDetail>(`/orders/by-id/${id}`);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<OrderStatus | null>(null);
  const remove = useDelete(() => router.push("/orders"));
  const back = <Link href="/orders" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"><ChevronLeft className="h-4 w-4" />All orders</Link>;
  const order = api.data;

  if (api.error && !order) return <div className="space-y-3">{back}<StateView kind="error" message={api.error} onRetry={() => void api.reload()} /></div>;
  if (!order) return <div className="space-y-3">{back}<TableSkeleton columns={6} rows={6} avatar={false} /></div>;

  async function save(payload: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await apiClient.patch<OrderDetail>(`/orders/by-id/${id}`, payload);
      api.setData(res.data);
      setEditing(false);
      toast.success("Order saved");
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    } finally { setSaving(false); }
  }

  async function changeStatus(note: string) {
    if (!order || !target) return;
    setSaving(true);
    try {
      if (order.managed) {
        const res = await apiClient.post<OrderDetail>(`/orders/by-id/${id}/status`, { status: target, note: note.trim() || null });
        api.setData(res.data);
      } else { // before the database update: the four delivery steps
        await apiClient.patch(`/orders/${order.leadId}`, { status: target, note: note.trim() || null });
        await api.reload();
      }
      toast.success(`#${order.orderNumber}: ${orderStatus(target).label}`);
      setTarget(null);
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    } finally { setSaving(false); }
  }

  const at = ORDER_FLOW.indexOf(order.status);
  // The usual next step: the first later stage this order may move to.
  const next = order.status === "on_hold" || order.status === "rejected" ? (order.moves.includes("ready") ? "ready" as const : undefined)
    : ORDER_FLOW.slice(at + 1).find((s) => order.moves.includes(s));
  const choose = (status: OrderStatus) => setTarget(status);

  if (editing) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Edit #{order.orderNumber} · {order.company.name}</h2>
        <OrderForm order={order} busy={saving} onCancel={() => setEditing(false)} onSubmit={(p) => void save(p)} />
      </div>
    );
  }

  const dealHref = order.leadId ? (order.pipeline === "client" ? `/projects/${order.leadId}` : `/leads/${order.leadId}`) : null;
  return (
    <div className="space-y-4">
      {back}

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-bold text-slate-900">#{order.orderNumber}</h1>
              <Pill status={order.status} />
              {order.source === "manual" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-600">Made by hand</span>}
            </div>
            <p className="mt-1 text-sm text-slate-500">{order.company.name}{order.company.city ? ` · ${order.company.city}` : ""} · Created {formatDate(order.createdAt)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {order.managed && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</Button>}
            {order.moves.length > 0 && (
              <select aria-label="Change status" value="" onChange={(e) => { if (e.target.value) choose(e.target.value as OrderStatus); }}
                className="h-10 cursor-pointer rounded-xl border border-slate-300/80 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-brand focus:ring-4 focus:ring-brand/15">
                <option value="">Change status…</option>
                {order.moves.map((s) => <option key={s} value={s}>{orderStatus(s).label}</option>)}
              </select>
            )}
            {next && <Button onClick={() => choose(next)}>{orderStatus(next).action}</Button>}
            {order.canDelete && <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => remove.ask({ path: `/orders/by-id/${order.id}`, title: `Delete #${order.orderNumber}?`, done: "Order deleted", message: "It disappears from Orders. The deal and its payment are not changed." })}><Trash2 className="h-4 w-4" />Delete</Button>}
          </div>
        </div>

        <ol aria-label="Order progress" className="flex overflow-x-auto py-1">
          {ORDER_FLOW.map((step, i) => {
            const done = at >= 0 && (i < at || (order.status === "delivered" && i === at));
            const current = i === at && order.status !== "delivered";
            return (
              <li key={step} aria-current={current ? "step" : undefined} className="relative flex min-w-[6rem] flex-1 basis-0 flex-col items-center gap-1.5 text-center">
                {/* the line from the stage before: coloured once this stage is reached, grey until then */}
                {i > 0 && <span aria-hidden="true" className={cn("absolute right-1/2 top-[0.9375rem] h-0.5 w-full", done || current ? "bg-brand" : "bg-slate-200")} />}
                <span className={cn("relative z-[1] flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold", done ? "bg-brand text-white" : current ? "bg-brand text-white ring-4 ring-brand/15" : "bg-slate-200 text-slate-500")}>{done ? <Check className="h-4 w-4" /> : i + 1}</span>
                <span className={cn("text-[12px] font-medium leading-tight", done || current ? "text-slate-900" : "text-slate-400")}>{orderStatus(step).label}</span>
              </li>
            );
          })}
        </ol>
        {order.managed && order.status === "new" && order.missing.length > 0 && <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">Before releasing to OMS, add {order.missing.join(", ")}.</p>}
      </Card>

      <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <Heading kind="items" title={`Items${order.items.length ? ` (${order.items.length})` : ""}`} />
            {!order.items.length ? <p className="px-5 py-8 text-center text-sm text-slate-500">No items on this order yet.{order.managed ? " Use Edit to add them." : ""}</p> : (
              <>
                <Table className="min-w-[34rem] [&_td]:px-2 [&_th]:px-2">
                  <TableHeader className="bg-slate-50/80"><TableRow className="hover:bg-transparent">
                    <TableHead className="!pl-5">#</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">GST ({order.gstRate}%)</TableHead><TableHead className="!pr-5 text-right">Total</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {order.items.map((item, i) => (
                      <TableRow key={`${item.name}-${i}`} className="align-top">
                        <TableCell className="!pl-5 tabular-nums text-slate-500">{i + 1}</TableCell>
                        <TableCell className="w-full min-w-[9rem] whitespace-normal">
                          <div className="font-semibold text-slate-900">{item.name}</div>
                          {item.details.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-slate-500">{item.details.map((d, n) => <li key={n}>{d.name}{d.description ? `: ${d.description}` : ""}</li>)}</ul>}
                          {item.photos.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{item.photos.map((url, n) => (
                            // eslint-disable-next-line @next/next/no-img-element -- a signed storage link
                            <a key={n} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${item.name} mockup ${n + 1}`} className="h-12 w-12 rounded-lg border border-slate-200 object-cover" /></a>
                          ))}</div>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{item.quantity.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(item.unitPrice, true)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(item.amount, true)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(item.gstAmount, true)}</TableCell>
                        <TableCell className="!pr-5 text-right font-semibold tabular-nums">{inr(item.lineTotal, true)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="border-t border-slate-200">{/* the line closes the table, full width */}
                <dl className="ml-auto w-full max-w-sm space-y-1.5 px-5 py-4 text-sm">
                  {([["Total quantity", order.units.toLocaleString("en-IN")], ["Subtotal", inr(order.subtotal, true)], ["Transportation", inr(order.transportation, true)], [`GST (${order.gstRate}%) on items and transportation`, inr(order.gstAmount, true)]] as const).map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4"><dt className="text-slate-500">{label}</dt><dd className="tabular-nums text-slate-900">{value}</dd></div>
                  ))}
                  <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 text-base font-semibold text-slate-900"><dt>Grand total</dt><dd className="tabular-nums">{inr(order.total, true)}</dd></div>
                  {order.balance != null && <>
                    <div className="flex justify-between gap-4"><dt className="text-slate-500">Paid</dt><dd className="tabular-nums text-emerald-700">{inr(order.paidAmount, true)}</dd></div>
                    <div className="flex justify-between gap-4 font-semibold"><dt className="text-slate-500">Balance</dt><dd className={cn("tabular-nums", order.balance > 0 ? "text-red-600" : "text-slate-900")}>{inr(order.balance, true)}</dd></div>
                  </>}
                </dl>
                </div>
              </>
            )}
          </Card>

          {/* everything about the order, under the full-width items */}
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Panel kind="client" title="Client">
            <div className="flex items-center gap-3">
              <Avatar src={order.contact?.photoUrl} name={order.company.name} size="md" square />
              <div className="min-w-0">
                {order.company.id ? <Link href={`/clients/${order.company.id}`} className="block truncate font-semibold text-slate-900 hover:text-brand">{order.company.name}</Link> : <p className="font-semibold">{order.company.name}</p>}
                <p className="truncate text-xs text-slate-500">{[order.contact?.name, order.contact?.designation].filter(Boolean).join(", ") || "No contact"}</p>
              </div>
            </div>
            <Facts rows={[["Phone", order.contact?.phone], ["Email", order.contact?.email], ["Account owner", order.owner?.fullName], ["Billing name", order.billingName], ["GSTIN", order.billingGstin]]} />
            {dealHref && <Link href={dealHref} className="text-sm font-medium text-brand hover:underline">Open the deal</Link>}
          </Panel>
          <Panel kind="payment" title="Payment">
            {order.payments.length ? order.payments.map((p) => (
              <Facts key={p.invoiceNumber} rows={[["Reference", p.invoiceNumber], ["Amount", inr(p.amount, true)], ["Received", inr(p.amountPaid, true)], ["Status", <span key="s" className="capitalize">{p.status}</span>], ["Confirmed", p.confirmedAt ? formatDate(p.confirmedAt) : ""]]} />
            )) : <p className="text-sm text-slate-500">{order.source === "manual" ? "No payment request is linked to an order made by hand." : "No payment request found."}</p>}
          </Panel>
            <Panel kind="delivery" title="Delivery"><Facts rows={[["Delivery date", order.expectedDelivery ? formatDate(order.expectedDelivery) : ""], ["Address", order.deliveryAddress], ["Receiver", order.receiverName], ["Phone", order.receiverPhone], ["Instructions", order.instructions]]} /></Panel>
            <Panel kind="shipment" title="Shipment"><Facts rows={[["Courier", order.courier], ["Tracking number", order.trackingNumber], ["Tracking link", order.trackingUrl ? <a href={order.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">Track <ExternalLink className="h-3.5 w-3.5" /></a> : ""], ["OMS reference", order.omsReference], ["Delivered on", order.deliveredAt ? when(order.deliveredAt) : ""]]} /></Panel>
          {order.notes && <Panel kind="notes" title="Internal notes"><p className="whitespace-pre-line text-sm text-slate-700">{order.notes}</p></Panel>}
          <Panel kind="history" title="History">
            {order.history.length ? (
              <ol className="space-y-3">
                {order.history.map((h, i) => (
                  <li key={i} className="border-l-2 border-slate-200 pl-3">
                    <p className="text-sm font-medium text-slate-900">{h.fromStatus ? `${orderStatus(h.fromStatus).label} → ${orderStatus(h.toStatus).label}` : "Order created"}</p>
                    <p className="text-xs text-slate-500">{h.by?.fullName ?? h.actorName ?? "System"} · {when(h.createdAt)}</p>
                    {h.note && h.fromStatus && <p className="mt-0.5 text-xs text-slate-600">{h.note}</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-slate-500">No status changes yet.</p>}
          </Panel>
        </div>
      </div>

      <StatusConfirm target={target && { from: order.status, to: target, orderNumber: order.orderNumber, company: order.company.name }}
        busy={saving} onCancel={() => setTarget(null)} onConfirm={(note) => void changeStatus(note)} />
      {remove.dialog}
    </div>
  );
}
