"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { STAGE_LABEL, todayIso } from "@/lib/format";
import { inr, inrShort } from "@/lib/money";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { AssignableUser, StageKey } from "@/types/crm";

type Report = {
  from: string; to: string;
  pipeline: { stage: StageKey; count: number; value: number; weighted: number; probability: number }[];
  forecast: { open: number; unweighted: number; weighted: number };
  conversion: { created: number; won: number; lost: number; wonValue: number; winRate: number | null };
  funnel: { stage: StageKey; count: number }[];
  lostReasons: { reason: string; count: number }[];
  sources: { source: string; leads: number; won: number; wonValue: number }[];
};

const INPUT = "h-10 rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15";

/** Date presets: this month, last month, this quarter, this year (all ending today or at the period end). */
function preset(key: string): [string, string] {
  const now = new Date(`${todayIso()}T00:00:00`);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const y = now.getFullYear(), m = now.getMonth();
  if (key === "last_month") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  if (key === "quarter") return [iso(new Date(y, Math.floor(m / 3) * 3, 1)), iso(now)];
  if (key === "year") return [iso(new Date(m >= 3 ? y : y - 1, 3, 1)), iso(now)]; // Indian financial year from April
  return [iso(new Date(y, m, 1)), iso(now)];
}
const PRESETS: [string, string][] = [["month", "This month"], ["last_month", "Last month"], ["quarter", "This quarter"], ["year", "This financial year"]];

/** One horizontal bar per row: a single measure in one brand hue, value label at the end, the exact figure on hover. */
function Bars({ rows, format, empty }: { rows: { key: string; label: string; value: number; hint?: string }[]; format: (n: number) => string; empty: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length || max === 0) return <p className="py-6 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="space-y-2.5" role="list">
      {rows.map((r) => (
        <li key={r.key} className="group grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm" title={`${r.label}: ${format(r.value)}${r.hint ? ` · ${r.hint}` : ""}`}>
          <span className="truncate text-slate-600">{r.label}</span>
          <span className="h-3 rounded-r-[4px] bg-slate-100">
            <span className="block h-full rounded-r-[4px] bg-brand/80 transition-colors group-hover:bg-brand" style={{ width: `${Math.max((r.value / max) * 100, r.value ? 1.5 : 0)}%` }} />
          </span>
          <span className="min-w-[4.5rem] text-right font-medium tabular-nums text-slate-800">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Reports for managers and admins: pipeline, weighted forecast, conversion funnel, lost reasons and lead sources. */
export default function ReportsPage() {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const router = useRouter();
  const allowed = !!user && isManager(user.role);
  const [range, setRange] = useState("month");
  const [[from, to], setDates] = useState<[string, string]>(() => preset("month"));
  const [owner, setOwner] = useState("");
  const report = useApi<Report>(allowed ? "/reports" : null, { from, to, ownerId: owner || undefined });
  const people = useApi<AssignableUser[]>(allowed ? "/users/assignable" : null);

  useEffect(() => { if (user && !allowed) router.replace("/today"); }, [user, allowed, router]);
  const r = report.data;
  const funnelTop = useMemo(() => (r?.funnel[0]?.count ?? 0), [r]);
  if (!allowed) return null;

  const tile = (label: string, value: string, hint?: string) => (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </Card>
  );

  return (
    <div className="space-y-5">
      {/* filters in one row above the charts */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Date range">
          {PRESETS.map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={range === key} onClick={() => { setRange(key); setDates(preset(key)); }}
              className={cn("pressable shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium", range === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
              {label}
            </button>
          ))}
        </div>
        <input type="date" aria-label="From" className={INPUT} value={from} max={to} onChange={(e) => { setRange("custom"); setDates([e.target.value, to]); }} />
        <span className="text-slate-400">to</span>
        <input type="date" aria-label="To" className={INPUT} value={to} min={from} max={todayIso()} onChange={(e) => { setRange("custom"); setDates([from, e.target.value]); }} />
        <select className={cn(INPUT, "sm:w-44")} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">Whole team</option>
          {people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
        </select>
      </div>

      {report.loading && !r && <div className="flex justify-center py-12"><Spinner /></div>}
      {report.error && !r && <StateView kind="error" message={report.error} onRetry={() => void report.reload()} />}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {tile("Leads created", String(r.conversion.created), "In this range")}
            {tile("Won", String(r.conversion.won), inr(r.conversion.wonValue))}
            {tile("Lost", String(r.conversion.lost))}
            {tile("Win rate", r.conversion.winRate == null ? "—" : `${r.conversion.winRate}%`, "Won ÷ (won + lost)")}
            {tile("Weighted forecast", inrShort(r.forecast.weighted), `${inrShort(r.forecast.unweighted)} across ${r.forecast.open} open`)}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card className="space-y-3 p-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Pipeline by stage</h2>
                <p className="text-xs text-slate-500">Open deal value today. Hover a bar for the count and weighted value.</p>
              </div>
              <Bars
                format={inrShort}
                empty="No open deals with a value."
                rows={r.pipeline.map((p) => ({ key: p.stage, label: STAGE_LABEL[p.stage] ?? p.stage, value: p.value, hint: `${p.count} ${p.count === 1 ? "deal" : "deals"}, weighted ${inr(p.weighted)} at ${p.probability}%` }))}
              />
            </Card>

            <Card className="space-y-3 p-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Conversion funnel</h2>
                <p className="text-xs text-slate-500">Leads that reached each stage in this range.</p>
              </div>
              <Bars
                format={(n) => String(n)}
                empty="No leads moved in this range."
                rows={r.funnel.map((f) => ({ key: f.stage, label: STAGE_LABEL[f.stage] ?? f.stage, value: f.count, hint: funnelTop ? `${Math.round((f.count / funnelTop) * 100)}% of new leads` : undefined }))}
              />
            </Card>

            <Card className="space-y-3 p-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Lost reasons</h2>
                <p className="text-xs text-slate-500">Deals closed as lost in this range.</p>
              </div>
              <Bars format={(n) => String(n)} empty="No deals lost in this range." rows={r.lostReasons.map((x) => ({ key: x.reason, label: x.reason, value: x.count }))} />
            </Card>

            <Card className="space-y-3 p-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Lead sources</h2>
                <p className="text-xs text-slate-500">Leads created in this range, and how many of them are won.</p>
              </div>
              {r.sources.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No leads created in this range.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr><th className="pb-2 font-medium">Source</th><th className="pb-2 text-right font-medium">Leads</th><th className="pb-2 text-right font-medium">Won</th><th className="pb-2 text-right font-medium">Conversion</th><th className="pb-2 text-right font-medium">Won value</th></tr>
                  </thead>
                  <tbody>
                    {r.sources.map((s) => (
                      <tr key={s.source} className="border-t border-slate-100">
                        <td className="py-2 text-slate-700">{s.source}</td>
                        <td className="py-2 text-right tabular-nums">{s.leads}</td>
                        <td className="py-2 text-right tabular-nums">{s.won}</td>
                        <td className="py-2 text-right tabular-nums">{s.leads ? `${Math.round((s.won / s.leads) * 100)}%` : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{inr(s.wonValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
