import type { OrderStatus } from "@/types/orders";

/** The stages in order; "rejected", "on_hold" and "cancelled" sit outside the line. */
export const ORDER_FLOW: OrderStatus[] = ["new", "ready", "accepted", "production", "quality_check", "packed", "dispatched", "delivered"];

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: string; action: string }> = {
  new: { label: "Not started", tone: "bg-slate-100 text-slate-600", action: "Reopen as draft" },
  ready: { label: "Handover Approved", tone: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200", action: "Release to OMS" },
  accepted: { label: "Accepted", tone: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200", action: "Mark as accepted" },
  rejected: { label: "Rejected", tone: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200", action: "Reject" },
  production: { label: "In production", tone: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200", action: "Start production" },
  quality_check: { label: "In quality check", tone: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200", action: "Move to quality check" },
  packed: { label: "Packed", tone: "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200", action: "Mark as packed" },
  dispatched: { label: "Dispatched", tone: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200", action: "Mark as dispatched" },
  delivered: { label: "Delivered", tone: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200", action: "Mark as delivered" },
  on_hold: { label: "On hold", tone: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200", action: "Put on hold" },
  cancelled: { label: "Cancelled", tone: "bg-slate-200 text-slate-600", action: "Cancel deal" },
};
export const orderStatus = (value?: string | null) => ORDER_STATUS[(value ?? "new") as OrderStatus] ?? ORDER_STATUS.new;
export const NEEDS_NOTE: OrderStatus[] = ["rejected", "on_hold", "cancelled"];
