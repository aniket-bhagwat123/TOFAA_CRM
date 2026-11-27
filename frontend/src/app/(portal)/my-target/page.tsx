"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TargetCard } from "@/components/crm/target-card";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { inr } from "@/lib/money";
import { useAppSelector } from "@/store/hooks";
import type { TargetCardData } from "@/types/crm";

/** A KAM's own month: target vs won, the gap, the pipeline, and what it takes to close the gap. */
export default function MyTargetPage() {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const router = useRouter();
  const allowed = user?.role === "kam";
  const card = useApi<TargetCardData>(allowed ? "/targets/card" : null);

  useEffect(() => { if (user && !allowed) router.replace("/"); }, [user, allowed, router]);
  if (!allowed) return null;

  const c = card.data;
  const stat = (label: string, value: string, hint?: string) => (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </Card>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="My Target" description="Your monthly target, what you have won so far, and what it takes to close the gap." />
      {card.loading && !c && <div className="flex justify-center py-12"><Spinner /></div>}
      {card.error && !c && <StateView kind="error" message={card.error} onRetry={() => void card.reload()} />}
      {c && (
        <>
          {c.target === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">No target is set for this month yet. Your manager sets it.</p>
          )}
          <TargetCard card={c} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stat("Average deal", c.avgDeal ? inr(c.avgDeal) : "—", "From your won deals")}
            {stat("Win rate", c.winRate != null ? `${Math.round(c.winRate * 100)}%` : "—", "Won ÷ (won + lost)")}
            {stat("Deals still needed", c.dealsNeeded != null ? String(c.dealsNeeded) : "—", "At your average deal")}
            {stat("Leads still needed", c.leadsNeeded != null ? String(c.leadsNeeded) : "—", "At your win rate")}
          </div>
          <p className="text-xs text-slate-400">Discount limit this month: {c.discountLimit}%</p>
        </>
      )}
    </div>
  );
}
