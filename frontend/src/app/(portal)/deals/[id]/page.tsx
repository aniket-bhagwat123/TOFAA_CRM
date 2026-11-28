"use client";
/** One order in full: items with GST and totals, payment, delivery, shipment, stage and history. */
import { Building2, Check, ExternalLink, History, IndianRupee, MapPin, Pencil, ShoppingBag, StickyNote, Trash2, Truck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { HandoverPanel } from "@/components/orders/handover-panel";
import { OrderForm } from "@/components/orders/order-form";
import { DealProgress } from "@/components/orders/deal-progress";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDelete } from "@/components/ui/use-delete";
import { useApi } from "@/hooks/use-api";
import { setCrumb } from "@/lib/crumb";
import { formatDate, formatTime } from "@/lib/format";
import { inr } from "@/lib/money";
import { orderStatus } from "@/lib/order-status";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { OrderDetail, OrderLine, OrderStatus } from "@/types/orders";

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
  const remove = useDelete(() => router.push("/deals"));
  const order = api.data;
  const company = order?.company.name;

  // Breadcrumb in the top bar, as on a lead: Orders > Company.
  useEffect(() => {
    if (!company) return;
    setCrumb({ path: `/deals/${id}`, parent: { href: "/deals", label: "Deals" }, label: company });
    return () => setCrumb(null);
  }, [id, company]);

  if (api.error && !order) return <StateView kind="error" message={api.error} onRetry={() => void api.reload()} />;
  if (!order) return <TableSkeleton columns={6} rows={6} avatar={false} />;

  async function save(payload: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await apiClient.patch<OrderDetail>(`/orders/by-id/${id}`, payload);
      api.setData(res.data);
      setEditing(false);
      toast.success("Deal saved");
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    } finally { setSaving(false); }
  }

  if (editing) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Edit {order.orderNumber} · {order.company.name}</h2>
        <OrderForm order={order} busy={saving} onCancel={() => setEditing(false)} onSubmit={(p) => void save(p)} />
      </div>
    );
  }

  // Items priced one by one get a row each; items sharing one price stay listed in their requirement's row.
  const priced = (item: OrderLine) => item.details.length > 0 && item.details.every((d) => d.amount != null);
  const byItem = order.items.some(priced);
  const dealHref = order.leadId ? (order.pipeline === "client" ? `/projects/${order.leadId}` : `/leads/${order.leadId}`) : null;
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900"><span className="font-mono">{order.orderNumber}</span> <span className="text-slate-400">·</span> {order.company.name}</h1>
              {order.omsOrderNumber ? <><span className="text-xs font-medium text-slate-500">Order Status</span><Pill status={order.status} /></> : order.status === "cancelled" && <Pill status={order.status} />}
              {order.source === "manual" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-600">Made by hand</span>}
            </div>
            <p className="mt-1 text-sm text-slate-500">{[order.company.city, `Created ${formatDate(order.createdAt)}`, order.handoverNumber && `Handover ${order.handoverNumber}`, order.legacyId && `Legacy ID ${order.legacyId}`].filter(Boolean).join(" · ")}</p>
            <p className="mt-1 text-sm font-medium text-slate-700">{order.omsOrderNumber ? <>Order Number <span className="font-mono">{order.omsOrderNumber}</span> · from the OMS</> : "Order: not created yet"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {order.managed && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</Button>}
            {order.canDelete && <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => remove.ask({ path: `/orders/by-id/${order.id}`, title: `Delete ${order.orderNumber}?`, done: "Deal deleted", message: "It disappears from Deals. The lead is not changed." })}><Trash2 className="h-4 w-4" />Delete</Button>}
          </div>
        </div>

        {order.handover && !order.omsOrderNumber && order.status !== "cancelled" && <DealProgress status={order.handoverStatus ?? "draft"} />}
      </Card>

      {/* reloads when the order itself changes, so both stay in step */}
      {order.handover && <HandoverPanel key={`${order.status}-${order.expectedDelivery}-${order.instructions}`} orderId={order.id} onChanged={() => void api.reload()} />}

      <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <Heading kind="items" title={`Items${order.items.length ? ` (${order.items.length})` : ""}`} />
            {!order.items.length ? <p className="px-5 py-8 text-center text-sm text-slate-500">No items on this deal yet.{order.managed ? " Use Edit to add them." : ""}</p> : (
              <>
                <Table className={cn(byItem ? "min-w-[52rem]" : "min-w-[34rem]", "[&_td]:px-2 [&_th]:px-2")}>
                  <TableHeader className="bg-slate-50/80"><TableRow className="hover:bg-transparent">
                    <TableHead className="!pl-5">#</TableHead><TableHead>Element</TableHead>{byItem && <TableHead>Description</TableHead>}<TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">GST ({order.gstRate}%)</TableHead><TableHead className="!pr-5 text-right">Total</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {order.items.map((item, i) => (
                      <Fragment key={`${item.name}-${i}`}>
                        {/* the requirement's row: its quantity and price */}
                        <TableRow className={cn("align-top", priced(item) && "bg-slate-50/60")}>
                          <TableCell className="!pl-5 tabular-nums text-slate-500">{i + 1}</TableCell>
                          <TableCell colSpan={byItem ? 2 : 1} className="w-full min-w-[12rem] whitespace-normal">
                            <div className="font-semibold text-slate-900">{item.name}</div>
                            {!priced(item) && item.details.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-slate-500">{item.details.map((d, n) => <li key={n}>{d.name}{d.description ? `: ${d.description}` : ""}</li>)}</ul>}
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
                        {priced(item) && item.details.map((element, n) => (
                          <TableRow key={n} className="align-top">
                            <TableCell className="!pl-5 text-xs tabular-nums text-slate-400">{i + 1}.{n + 1}</TableCell>
                            <TableCell className="min-w-[12rem] whitespace-normal text-slate-800">{element.name}</TableCell>
                            <TableCell className="min-w-[14rem] whitespace-normal text-slate-500">{element.description || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{element.quantity?.toLocaleString("en-IN")}</TableCell>
                            <TableCell className="text-right tabular-nums">{inr(element.unitPrice ?? 0, true)}</TableCell>
                            <TableCell className="text-right tabular-nums">{inr(element.amount ?? 0, true)}</TableCell>
                            <TableCell className="text-right tabular-nums">{inr(element.gstAmount ?? 0, true)}</TableCell>
                            <TableCell className="!pr-5 text-right tabular-nums">{inr(element.lineTotal ?? 0, true)}</TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
                <div className="border-t border-slate-200">{/* the line closes the table, full width */}
                <dl className="ml-auto w-full max-w-sm space-y-1.5 px-5 py-4 text-sm">
                  {([["Total quantity", order.units.toLocaleString("en-IN")], ["Subtotal", inr(order.subtotal, true)], ["Transportation", inr(order.transportation, true)], [`GST (${order.gstRate}%) on items and transportation`, inr(order.gstAmount, true)]] as const).map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4"><dt className="text-slate-500">{label}</dt><dd className="tabular-nums text-slate-900">{value}</dd></div>
                  ))}
                  <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 text-base font-semibold text-slate-900"><dt>Grand total</dt><dd className="tabular-nums">{inr(order.total, true)}</dd></div>
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
            <Facts rows={[["Phone", order.contact?.phone], ["Email", order.contact?.email], ["Sales Owner", order.owner?.fullName], ["Billing name", order.billingName], ["GSTIN", order.billingGstin]]} />
            {dealHref && <Link href={dealHref} className="text-sm font-medium text-brand hover:underline">Open the deal</Link>}
          </Panel>
          {order.handover && (
            <Panel kind="payment" title="Payment">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500">Payment status</span>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", order.paymentStatus === "success" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")}>{order.paymentStatus === "success" ? "Success" : "Pending"}</span>
              </div>
              <p className="text-xs text-slate-500">Updated by the OMS.</p>
            </Panel>
          )}

            <Panel kind="delivery" title="Delivery"><Facts rows={[["Requested Delivery Date", order.expectedDelivery ? formatDate(order.expectedDelivery) : ""], ["Address", order.deliveryAddress], ["Receiver", order.receiverName], ["Phone", order.receiverPhone], ["Instructions", order.instructions]]} /></Panel>
            <Panel kind="shipment" title="Shipment"><Facts rows={[["Courier", order.courier], ["Tracking number", order.trackingNumber], ["Tracking link", order.trackingUrl ? <a href={order.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">Track <ExternalLink className="h-3.5 w-3.5" /></a> : ""], ["OMS reference", order.omsReference], ["Delivered on", order.deliveredAt ? when(order.deliveredAt) : ""]]} /></Panel>
          {order.notes && <Panel kind="notes" title="Internal notes"><p className="whitespace-pre-line text-sm text-slate-700">{order.notes}</p></Panel>}
          <Panel kind="history" title="History">
            {order.history.length ? (
              <ol className="space-y-3">
                {order.history.map((h, i) => (
                  <li key={i} className="border-l-2 border-slate-200 pl-3">
                    <p className="text-sm font-medium text-slate-900">{h.fromStatus ? `${orderStatus(h.fromStatus).label} → ${orderStatus(h.toStatus).label}` : "Deal created"}</p>
                    <p className="text-xs text-slate-500">{h.by?.fullName ?? h.actorName ?? "System"} · {when(h.createdAt)}</p>
                    {h.note && h.fromStatus && <p className="mt-0.5 text-xs text-slate-600">{h.note}</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-slate-500">No status changes yet.</p>}
          </Panel>
        </div>
      </div>

      {remove.dialog}
    </div>
  );
}
