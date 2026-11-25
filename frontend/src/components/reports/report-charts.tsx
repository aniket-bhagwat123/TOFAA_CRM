"use client";
/**
 * Report charts on shadcn/ui charts (components/ui/chart.tsx, Recharts 2). One file for every chart on the Reports
 * page, so nothing is drawn twice. Colours: the validated categorical order (blue, orange, aqua, yellow, magenta,
 * green, violet), checked with the colour-blindness validator on the white card; "Other" is a neutral grey.
 * Every chart has its numbers visible as labels, a legend, or a table view, so nothing depends on hovering.
 */
import { Bar, BarChart, CartesianGrid, Cell, Label, LabelList, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

export const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
export const OTHER = "#898781";
export const BLUE = CATEGORICAL[0];
export const ORANGE = CATEGORICAL[1];

export type TrendPoint = { label: string; full: string; [series: string]: string | number };

/** A tooltip row: colour key, name, value (formatted). */
const row = (color: string, name: string, value: string) => (
  <div className="flex w-full items-center gap-2">
    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
    <span className="flex-1 text-slate-500">{name}</span>
    <span className="font-semibold tabular-nums text-slate-900">{value}</span>
  </div>
);

const fullLabel = (_: unknown, payload: { payload?: { full?: string } }[]) => payload?.[0]?.payload?.full ?? "";

/** Revenue per period as columns: 24px max, 4px rounded top on a square baseline. */
export function RevenueChart({ data, format, axis }: { data: TrendPoint[]; format: (n: number) => string; axis: (n: number) => string }) {
  const config = { revenue: { label: "Revenue", color: BLUE } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={axis} allowDecimals={false} />
        <ChartTooltip cursor content={<ChartTooltipContent labelFormatter={fullLabel} formatter={(v) => row(BLUE, "Revenue", format(Number(v)))} />} />
        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ChartContainer>
  );
}

/** Leads created vs deals won per period: two 2px lines, a legend, one tooltip listing both. */
export function FlowChart({ data }: { data: TrendPoint[] }) {
  const config = { created: { label: "Leads created", color: BLUE }, won: { label: "Deals won", color: ORANGE } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip cursor content={<ChartTooltipContent labelFormatter={fullLabel} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line dataKey="created" type="monotone" stroke="var(--color-created)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
        <Line dataKey="won" type="monotone" stroke="var(--color-won)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
      </LineChart>
    </ChartContainer>
  );
}

/**
 * Horizontal bars, one per row (funnel stages, pipeline stages): a single measure in one hue, the row's label on the
 * left, its value label at the bar end (so every number is visible without hovering).
 */
export function RowBarChart({ rows, format, valueLabel, tooltip, minHeight = 0 }: {
  rows: { key: string; label: string; value: number; end?: string; hint?: string }[];
  format: (n: number) => string;
  valueLabel: string;
  tooltip?: boolean;
  minHeight?: number;
}) {
  const config = { value: { label: valueLabel, color: BLUE } } satisfies ChartConfig;
  const height = Math.max(minHeight, rows.length * 34 + 8);
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 96, left: 0, bottom: 0 }} barCategoryGap={8} accessibilityLayer>
        <XAxis type="number" dataKey="value" hide domain={[0, "dataMax"]} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={150} tick={{ fontSize: 13 }} interval={0} />
        {tooltip !== false && (
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel formatter={(v, _n, item) => row(BLUE, `${item.payload.label}${item.payload.hint ? ` · ${item.payload.hint}` : ""}`, format(Number(v)))} />} />
        )}
        <Bar dataKey="value" fill="var(--color-value)" radius={4} maxBarSize={20} background={{ fill: "#f1f5f9", radius: 4 }}>
          <LabelList dataKey="end" position="right" offset={10} className="fill-slate-700" fontSize={12} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/**
 * Donut: one whole split into up to 8 parts, the total in the centre, a legend under it with each part's count and
 * share. Colours follow the part (fixed per source / reason), never its rank.
 */
export function DonutChart({ parts, total, unit, format }: {
  parts: { key: string; label: string; value: number; color: string }[];
  total: number;
  unit: string; // under the centre number: "leads", "deals lost"
  format: (n: number) => string;
}) {
  const shown = parts.filter((p) => p.value > 0);
  const config = Object.fromEntries(shown.map((p, i) => [`p${i}`, { label: p.label, color: p.color }])) satisfies ChartConfig;
  const data = shown.map((p, i) => ({ part: `p${i}`, name: p.label, value: p.value, color: p.color, fill: `var(--color-p${i})` }));
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
      <ChartContainer config={config} className="mx-auto aspect-square h-[200px] w-[200px]">
        <PieChart accessibilityLayer>
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="part" formatter={(v, _n, item) => row(item.payload.color, item.payload.name, `${format(Number(v))} · ${Math.round((Number(v) / total) * 100)}%`)} />} />
          <Pie data={data} dataKey="value" nameKey="part" innerRadius={58} outerRadius={88} strokeWidth={2} stroke="#ffffff" paddingAngle={shown.length > 1 ? 1 : 0}>
            {data.map((d) => <Cell key={d.part} fill={d.fill} />)}
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) - 6} className="fill-slate-900 text-2xl font-semibold">{total.toLocaleString("en-IN")}</tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 16} className="fill-slate-500 text-xs">{unit}</tspan>
                  </text>
                );
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="space-y-1.5 text-sm" aria-label="Legend">
        {shown.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: p.color }} />
            <span className={cn("min-w-0 flex-1 truncate", p.color === OTHER ? "italic text-slate-500" : "text-slate-700")}>{p.label}</span>
            <span className="font-medium tabular-nums text-slate-800">{format(p.value)}</span>
            <span className="w-10 text-right tabular-nums text-slate-400">{Math.round((p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The table twin of a trend chart: every value without hovering. */
export function TrendTable({ data, columns }: { data: TrendPoint[]; columns: { key: string; label: string; format: (n: number) => string }[] }) {
  return (
    <div className="max-h-[240px] overflow-auto rounded-lg border border-slate-100">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
          <tr><th className="px-3 py-2 font-medium">Period</th>{columns.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.full} className="border-t border-slate-100">
              <td className="px-3 py-1.5 text-slate-600">{p.full}</td>
              {columns.map((c) => <td key={c.key} className="px-3 py-1.5 text-right tabular-nums text-slate-800">{c.format(Number(p[c.key] ?? 0))}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Chart | Table" switch for a chart card. */
export function ViewSwitch({ table, onChange }: { table: boolean; onChange: (table: boolean) => void }) {
  return (
    <div className="flex shrink-0 rounded-lg bg-slate-100 p-0.5 text-xs font-medium" role="radiogroup" aria-label="Show as">
      {[false, true].map((t) => (
        <button key={String(t)} type="button" role="radio" aria-checked={table === t} onClick={() => onChange(t)}
          className={cn("rounded-md px-2.5 py-1", table === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
          {t ? "Table" : "Chart"}
        </button>
      ))}
    </div>
  );
}
