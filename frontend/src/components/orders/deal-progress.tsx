/** The CRM's part of a deal's road, up to the handover. After the OMS creates the Order, its Order Status is shown instead. */
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HandoverStatus } from "@/types/orders";

const STEPS = ["Deal Created", "Handover Draft", "Sales Manager Approval", "Handover Approved", "Order Created"];
// The step being worked on, per handover status.
const AT: Record<HandoverStatus, number> = { draft: 1, rejected: 1, pending_approval: 2, approved: 4, cancelled: 1 };

export function DealProgress({ status }: { status: HandoverStatus }) {
  const at = AT[status];
  return (
    <ol aria-label="Deal progress" className="flex overflow-x-auto py-1">
      {STEPS.map((label, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <li key={label} aria-current={current ? "step" : undefined} className="relative flex min-w-[6.5rem] flex-1 basis-0 flex-col items-center gap-1.5 text-center">
            {i > 0 && <span aria-hidden="true" className={cn("absolute right-1/2 top-[0.9375rem] h-0.5 w-full", done || current ? "bg-brand" : "bg-slate-200")} />}
            <span className={cn("relative z-[1] flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold", done ? "bg-brand text-white" : current ? "bg-brand text-white ring-4 ring-brand/15" : "bg-slate-200 text-slate-500")}>{done ? <Check className="h-4 w-4" /> : i + 1}</span>
            <span className={cn("text-[12px] font-medium leading-tight", done || current ? "text-slate-900" : "text-slate-400")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
