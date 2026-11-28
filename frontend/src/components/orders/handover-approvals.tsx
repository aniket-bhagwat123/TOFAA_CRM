"use client";
/** Order handovers waiting for a Sales Manager. Each is approved on its order page, where all of it can be read. */
import { PackageOpen } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

export type PendingHandover = {
  orderId: string; orderNumber: string; handoverNumber?: string | null; companyName?: string | null; ownerName?: string | null; totalKits?: number | null;
  deliveryDeadline?: string | null; advancePercent?: number | null; version: number; submittedAt?: string | null;
};

export function HandoverApprovals({ items }: { items: PendingHandover[] }) {
  return (
    <Card className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <PackageOpen className="h-4 w-4 text-amber-500" /> Deal handovers waiting for approval
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{items.length}</span>
      </h2>
      {items.map((item) => (
        <div key={item.orderId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200/70 bg-amber-50/40 p-3">
          <div className="min-w-0">
            <p className="font-medium text-slate-900">{item.handoverNumber ?? item.orderNumber} · {item.companyName}</p>
            <p className="text-xs text-slate-500">
              {[item.ownerName, item.totalKits ? `Kit Quantity ${item.totalKits}` : "", item.deliveryDeadline ? `Requested ${formatDate(item.deliveryDeadline)}` : "",
                item.advancePercent == null ? "" : `Bulk Advance ${item.advancePercent}%`, item.version ? "edit of an approved handover" : "new"].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Link href={`/deals/${item.orderId}`} className="text-sm font-medium text-brand hover:underline">Review</Link>
        </div>
      ))}
    </Card>
  );
}
