"use client";
import { CheckCircle2, CircleAlert, Hourglass, PlugZap, Wallet } from "lucide-react";
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/format";
import { inr, inrShort } from "@/lib/money";
import { Empty, Section, Tile } from "./widgets";

export type FinanceData = {
  waiting: { count: number; amount: number };
  partial: { count: number; outstanding: number };
  confirmedThisMonth: { count: number; amount: number };
  waitingList: { id: string; invoiceNumber: string; amount: number; amountPaid: number; status: "requested" | "partial"; requestedAt: string; companyName?: string }[];
  erp: { configured: boolean; fallbackEnabled: boolean; lastConfirmationAt?: string | null; lastInvoice?: string | null } | null;
};

/** Finance: what is waiting to be paid, what is part-paid, what came in this month, and whether the ERP is connected. */
export function FinanceDashboard({ d }: { d: FinanceData }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile label="Waiting for payment" value={inrShort(d.waiting.amount)} hint={`${d.waiting.count} ${d.waiting.count === 1 ? "invoice" : "invoices"}`} icon={Hourglass} tone={d.waiting.count ? "text-amber-600" : ""} href="/payments" />
        <Tile label="Part-paid, still due" value={inrShort(d.partial.outstanding)} hint={`${d.partial.count} ${d.partial.count === 1 ? "invoice" : "invoices"}`} icon={Wallet} href="/payments" />
        <Tile label="Received this month" value={inrShort(d.confirmedThisMonth.amount)} hint={`${d.confirmedThisMonth.count} confirmed`} icon={CheckCircle2} tone="text-emerald-600" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Section title="Oldest invoices waiting" icon={Hourglass} href="/payments" linkLabel="Payments" className="lg:col-span-2">
          {d.waitingList.length === 0 ? <Empty>Nothing waiting. Every invoice is paid.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {d.waitingList.map((p) => (
                <li key={p.id}>
                  <Link href="/payments" className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-brand">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{p.companyName}</span>
                      <span className="block truncate text-xs text-slate-500">{p.invoiceNumber} · requested {formatDate(p.requestedAt)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums text-slate-900">{inr(p.amount)}</span>
                      {p.status === "partial" && <span className="block text-xs text-amber-600">{inr(p.amountPaid)} received</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="ERP connection" icon={PlugZap}>
          {!d.erp ? <Empty>Status not available.</Empty> : (
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2 font-medium">
                {d.erp.configured ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <CircleAlert className="h-4 w-4 text-amber-500" />}
                {d.erp.configured ? "Connected: the ERP confirms payments" : "Not connected: confirm payments by hand"}
              </p>
              <p className="text-xs text-slate-500">Last ERP confirmation: {d.erp.lastConfirmationAt ? `${formatDateTime(d.erp.lastConfirmationAt)}${d.erp.lastInvoice ? ` · ${d.erp.lastInvoice}` : ""}` : "none yet"}</p>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
