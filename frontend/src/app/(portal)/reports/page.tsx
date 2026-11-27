"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BLUE, CATEGORICAL, DonutChart, FlowChart, OTHER, RevenueChart, RowBarChart, TrendTable, ViewSwitch, type TrendPoint,
} from "@/components/reports/report-charts";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { PageHeader } from "@/components/ui/page-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { STAGE_LABEL, todayIso } from "@/lib/format";
import { inr, inrShort } from "@/lib/money";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { AssignableUser, StageKey } from "@/types/crm";

type Summary = { created: number; won: number; lost: number; wonValue: number; winRate: number | null };
type Report = {
  from: string; to: string;
  previous: Summary & { from: string; to: string };
  trend: { granularity: "day" | "week" | "month"; points: { start: string; created: number; won: number; lost: number; wonValue: number }[] };
  team: { ownerId: string; name: string; created: number; won: number; lost: number; wonValue: number; winRate: number | null; open: number; openValue: number }[];
  pipeline: { stage: StageKey; pipeline: "new_business" | "client"; count: number; valued: number; value: number; weighted: number; probability: number }[];
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


/** A bucket's short axis label and its full tooltip/table label. */
function bucketLabels(start: string, gran: "day" | "week" | "month"): { label: string; full: string } {
  const d = new Date(`${start}T00:00:00`);
  const day = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (gran === "month") return { label: d.toLocaleDateString("en-IN", { month: "short" }), full: d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) };
  if (gran === "week") return { label: day, full: `Week of ${day}` };
  return { label: day, full: d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) };
}

/** Compact axis numbers: 0 / 50K / 1.5L / 2Cr for money, plain for counts. */
const axisMoney = (n: number) => (n === 0 ? "0" : inrShort(n).replace("₹", ""));
const axisCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Change against the previous period: signed %, coloured by whether up is good. */
function Delta({ now, before, upIsGood = true, money }: { now: number | null; before: number | null; upIsGood?: boolean; money?: boolean }) {
  if (now == null || before == null) return null;
  if (before === 0 && now === 0) return <span className="text-slate-400">No change</span>;
  if (before === 0) return <span className="text-slate-500">New this period</span>;
  const pct = ((now - before) / Math.abs(before)) * 100;
  const up = pct > 0;
  const good = pct === 0 ? null : up === upIsGood;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-medium", good == null ? "text-slate-500" : good ? "text-[#006300]" : "text-red-700")}
      title={`Previous period: ${money ? inr(before) : before}`}>
      <span aria-hidden="true">{pct === 0 ? "•" : up ? "▲" : "▼"}</span>
      {Math.abs(pct) >= 100 ? `${Math.round(Math.abs(pct))}%` : `${Math.abs(pct).toFixed(1)}%`}
      <span className="sr-only">{up ? "up" : "down"}</span>
    </span>
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

  useEffect(() => { if (user && !allowed) router.replace("/dashboard"); }, [user, allowed, router]);
  const r = report.data;
  if (!allowed) return null;

  const tile = (label: string, value: string, hint?: string, delta?: React.ReactNode) => (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold text-slate-900">{value}</div>
      {(delta || hint) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-400">
          {delta}{delta && <span>vs previous period</span>}{hint && <span className="w-full">{hint}</span>}
        </div>
      )}
    </Card>
  );
  const prev = r?.previous;

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
        <DatePicker size="sm" ariaLabel="From" required value={from} max={to} onChange={(d) => { if (d) { setRange("custom"); setDates([d, to]); } }} />
        <span className="text-slate-400">to</span>
        <DatePicker size="sm" ariaLabel="To" required value={to} min={from} max={todayIso()} onChange={(d) => { if (d) { setRange("custom"); setDates([from, d]); } }} />
        <select className={cn(INPUT, "sm:w-44")} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">Whole team</option>
          {people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
        </select>
      </div>

      {report.loading && !r && <TableSkeleton columns={7} rows={6} avatar={false} />}
      {report.error && !r && <StateView kind="error" message={report.error} onRetry={() => void report.reload()} />}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {tile("Revenue won", inrShort(r.conversion.wonValue), `${r.conversion.won} ${r.conversion.won === 1 ? "deal" : "deals"} paid`, <Delta now={r.conversion.wonValue} before={prev?.wonValue ?? null} money />)}
            {tile("Leads created", String(r.conversion.created), undefined, <Delta now={r.conversion.created} before={prev?.created ?? null} />)}
            {tile("Lost", String(r.conversion.lost), undefined, <Delta now={r.conversion.lost} before={prev?.lost ?? null} upIsGood={false} />)}
            {tile("Win rate", r.conversion.winRate == null ? "—" : `${r.conversion.winRate}%`, "Won ÷ (won + lost)", <Delta now={r.conversion.winRate} before={prev?.winRate ?? null} />)}
            {tile("Weighted forecast", inrShort(r.forecast.weighted), `${inrShort(r.forecast.unweighted)} across ${r.forecast.open} open deals`)}
          </div>

          <TrendCards report={r} />
          <TeamCard team={r.team} />

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <PipelineCard rows={r.pipeline} />
            <FunnelCard funnel={r.funnel} />
            <LostCard reasons={r.lostReasons} />
            <SourcesCard sources={r.sources} />
          </div>
        </>
      )}
    </div>
  );
}

/** Revenue over time (bar chart) and leads created vs deals won (line chart), each with a table view. */
function TrendCards({ report: r }: { report: Report }) {
  const [revTable, setRevTable] = useState(false);
  const [flowTable, setFlowTable] = useState(false);
  const gran = r.trend.granularity;
  const per = gran === "day" ? "day" : gran === "week" ? "week" : "month";
  const data: TrendPoint[] = r.trend.points.map((p) => ({ ...bucketLabels(p.start, gran), revenue: p.wonValue, created: p.created, won: p.won }));
  const totalRev = r.trend.points.reduce((a, p) => a + p.wonValue, 0);
  const best = r.trend.points.reduce<null | { start: string; wonValue: number }>((b, p) => (p.wonValue > (b?.wonValue ?? 0) ? p : b), null);
  const count = (n: number) => String(n);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Revenue trend</h2>
            <p className="text-xs text-slate-500">
              Payments confirmed, per {per}.{best ? <> Best {per}: <b className="font-semibold text-slate-700">{bucketLabels(best.start, gran).full}</b> ({inrShort(best.wonValue)}).</> : null}
            </p>
          </div>
          <ViewSwitch table={revTable} onChange={setRevTable} />
        </div>
        {totalRev === 0 ? (
          <p className="py-14 text-center text-sm text-slate-400">No payments confirmed in this range.</p>
        ) : revTable ? (
          <TrendTable data={data} columns={[{ key: "revenue", label: "Revenue", format: inr }]} />
        ) : (
          <RevenueChart data={data} format={inr} axis={axisMoney} />
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Leads created vs deals won</h2>
            <p className="text-xs text-slate-500">Per {per}: new leads coming in, and deals paid.</p>
          </div>
          <ViewSwitch table={flowTable} onChange={setFlowTable} />
        </div>
        {r.trend.points.every((p) => !p.created && !p.won) ? (
          <p className="py-14 text-center text-sm text-slate-400">No leads created or won in this range.</p>
        ) : flowTable ? (
          <TrendTable data={data} columns={[{ key: "created", label: "Leads created", format: count }, { key: "won", label: "Deals won", format: count }]} />
        ) : (
          <FlowChart data={data} />
        )}
      </Card>
    </div>
  );
}

/** Team leaderboard: one row per salesperson, revenue first, with a bar for each person's revenue. */
function TeamCard({ team }: { team: Report["team"] }) {
  if (team.length === 0) return null;
  const max = Math.max(...team.map((t) => t.wonValue), 0);
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Team performance</h2>
        <p className="text-xs text-slate-500">In this range, highest revenue first. Open pipeline is today's value of each person's open deals.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="pb-2 font-medium">Salesperson</th>
              <th className="pb-2 font-medium">Revenue won</th>
              <th className="pb-2 text-right font-medium">Won</th>
              <th className="pb-2 text-right font-medium">Lost</th>
              <th className="pb-2 text-right font-medium">Win rate</th>
              <th className="pb-2 text-right font-medium">Leads created</th>
              <th className="pb-2 text-right font-medium">Open pipeline</th>
            </tr>
          </thead>
          <tbody>
            {team.map((t) => (
              <tr key={t.ownerId} className="border-t border-slate-100">
                <td className="py-2 pr-3 font-medium text-slate-800">{t.name}</td>
                <td className="w-[34%] py-2 pr-4">
                  <div className="flex items-center gap-2" title={`${t.name}: ${inr(t.wonValue)}`}>
                    <span className="h-2 flex-1 rounded-full bg-slate-100">
                      <span className="block h-full rounded-full" style={{ width: `${max ? Math.max((t.wonValue / max) * 100, t.wonValue ? 2 : 0) : 0}%`, background: BLUE }} />
                    </span>
                    <span className="w-20 text-right tabular-nums text-slate-800">{inrShort(t.wonValue)}</span>
                  </div>
                </td>
                <td className="py-2 text-right tabular-nums">{t.won}</td>
                <td className="py-2 text-right tabular-nums">{t.lost}</td>
                <td className="py-2 text-right tabular-nums">{t.winRate == null ? "—" : `${t.winRate}%`}</td>
                <td className="py-2 text-right tabular-nums">{t.created}</td>
                <td className="py-2 text-right tabular-nums">{inrShort(t.openValue)} <span className="text-xs text-slate-400">({t.open})</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const deals = (n: number) => `${n} ${n === 1 ? "deal" : "deals"}`;

/** Each source / lost reason keeps its own colour whatever the filter (colour follows the entity, never its rank).
 * Seven named ones take the validated categorical order; anything else is folded into a grey "Other". */
const SOURCE_SLOTS = ["Referral", "Website", "Existing client", "LinkedIn", "Instagram", "Cold call", "WhatsApp"];
const LOST_SLOTS = ["Price too high", "Chose competitor", "No budget", "No response", "Not a fit", "Postponed", "Invalid contact"];

function toParts(rows: { name: string; value: number }[], slots: string[], otherLabel: string) {
  const named = slots
    .map((name, i) => ({ key: name, label: name, value: rows.find((r) => r.name === name)?.value ?? 0, color: CATEGORICAL[i] }))
    .filter((p) => p.value > 0);
  const rest = rows.filter((r) => !slots.includes(r.name)).reduce((a, r) => a + r.value, 0);
  return rest ? [...named, { key: "__other", label: otherLabel, value: rest, color: OTHER }] : named;
}

/** Open pipeline today, split by pipeline (new business / client projects), each a bar chart in its own stage order.
 * Every bar is labelled with its value and deal count, so a stage whose deals have no value yet still shows. */
function PipelineCard({ rows }: { rows: Report["pipeline"] }) {
  const groups = [
    { key: "new_business", title: "New business", rows: rows.filter((p) => p.pipeline !== "client") },
    { key: "client", title: "Client projects", rows: rows.filter((p) => p.pipeline === "client") },
  ].filter((g) => g.rows.length);
  const total = rows.reduce((a, p) => a + p.value, 0);
  const count = rows.reduce((a, p) => a + p.count, 0);
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Pipeline by stage</h2>
        <p className="text-xs text-slate-500">Open deals today: {deals(count)} worth {inrShort(total)}. Hover a bar for the weighted value.</p>
      </div>
      {groups.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">No open deals.</p> : groups.map((g) => {
        const sub = g.rows.reduce((a, p) => a + p.value, 0);
        return (
          <div key={g.key} className="space-y-1">
            {groups.length > 1 && (
              <h3 className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-wide text-slate-400">
                <span>{g.title}</span><span className="normal-case tracking-normal">{inrShort(sub)}{total ? ` · ${Math.round((sub / total) * 100)}%` : ""}</span>
              </h3>
            )}
            <RowBarChart
              valueLabel="Value" format={inrShort}
              rows={g.rows.map((p) => ({
                key: p.stage, label: STAGE_LABEL[p.stage] ?? p.stage, value: p.value,
                end: `${inrShort(p.value)} · ${deals(p.count)}`,
                hint: `${deals(p.count)}${p.valued < p.count ? ` (${p.count - p.valued} without value)` : ""}, weighted ${inrShort(p.weighted)} at ${p.probability}%`,
              }))}
            />
          </div>
        );
      })}
    </Card>
  );
}

/** Conversion funnel: leads that reached each stage or went further (so it only narrows), as a bar chart with
 * each stage's count and % of new leads on the bar. */
function FunnelCard({ funnel }: { funnel: Report["funnel"] }) {
  const top = funnel[0]?.count ?? 0;
  const won = funnel[funnel.length - 1]?.count ?? 0;
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Conversion funnel</h2>
        <p className="text-xs text-slate-500">
          New leads in this range and how far they got.{top ? <> Overall: <b className="font-semibold text-slate-700">{Math.round((won / top) * 100)}%</b> of new leads were won.</> : null}
        </p>
      </div>
      {top ? (
        <RowBarChart
          valueLabel="Leads" format={(n) => `${n} leads`}
          rows={funnel.map((f, i) => ({
            key: f.stage, label: STAGE_LABEL[f.stage] ?? f.stage, value: f.count,
            end: `${f.count} · ${Math.round((f.count / top) * 100)}%`,
            hint: i && funnel[i - 1].count ? `${Math.round((f.count / funnel[i - 1].count) * 100)}% of the stage before` : "everyone starts here",
          }))}
        />
      ) : (
        <p className="py-6 text-center text-sm text-slate-400">No new leads in this range.</p>
      )}
    </Card>
  );
}

/** Lost reasons: a donut of each reason's share of all deals lost, with a legend of counts. */
function LostCard({ reasons }: { reasons: Report["lostReasons"] }) {
  const total = reasons.reduce((a, x) => a + x.count, 0);
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Lost reasons</h2>
        <p className="text-xs text-slate-500">{total ? `${deals(total)} closed as lost in this range.` : "Deals closed as lost in this range."}</p>
      </div>
      {total ? (
        <DonutChart total={total} unit={total === 1 ? "deal lost" : "deals lost"} format={(n) => String(n)}
          parts={toParts(reasons.map((x) => ({ name: x.reason, value: x.count })), LOST_SLOTS, "Other / not given")} />
      ) : (
        <p className="py-6 text-center text-sm text-slate-400">No deals lost in this range.</p>
      )}
    </Card>
  );
}

/** Lead sources: a donut of where leads came from, then the table (leads, won, conversion, revenue).
 * Warns when too many leads have no source to learn from. */
function SourcesCard({ sources }: { sources: Report["sources"] }) {
  const leads = sources.reduce((a, s) => a + s.leads, 0);
  const missing = sources.find((s) => s.source === "Not given")?.leads ?? 0;
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Lead sources</h2>
        <p className="text-xs text-slate-500">Leads created in this range, and how many of them were won.</p>
      </div>
      {leads > 0 && missing / leads >= 0.3 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b className="font-semibold">{missing} of {leads} leads have no source</b>, so this report cannot show which channel works best. Pick a source when adding a lead.
        </p>
      )}
      {leads === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No leads created in this range.</p>
      ) : (
        <>
          <DonutChart total={leads} unit={leads === 1 ? "lead" : "leads"} format={(n) => String(n)}
            parts={toParts(sources.map((x) => ({ name: x.source, value: x.leads })), SOURCE_SLOTS, "Other / not given")} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 text-right font-medium">Leads</th>
                  <th className="pb-2 text-right font-medium">Won</th>
                  <th className="pb-2 text-right font-medium">Conversion</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((x) => (
                  <tr key={x.source} className="border-t border-slate-100">
                    <td className={cn("py-2", x.source === "Not given" ? "italic text-slate-400" : "text-slate-700")}>{x.source}</td>
                    <td className="py-2 text-right tabular-nums">{x.leads}</td>
                    <td className="py-2 text-right tabular-nums">{x.won}</td>
                    <td className="py-2 text-right tabular-nums">{x.leads ? `${Math.round((x.won / x.leads) * 100)}%` : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{inrShort(x.wonValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
