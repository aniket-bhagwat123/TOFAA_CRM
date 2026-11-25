"use client";
import { Archive, ArchiveRestore, Cake, Heart, Pencil, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { formatFullDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Person } from "@/types/people";
import { mobileText, relationshipOf } from "./labels";

type SortKey = "name" | "city" | "nextOccasion" | "created";
type Props = {
  people: Person[];
  showAccount: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
  onOpen: (p: Person) => void;
  onEdit: (p: Person) => void;
  onArchive: (p: Person) => void;
  onDelete: (p: Person) => void;
};

type Occasion = NonNullable<Person["nextOccasion"]>;

function daysText(days: number): string {
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
}

/** The next birthday or anniversary: a round icon, the occasion in bold and its date below ("11 Dec 2026"). */
function OccasionCell({ occasion }: { occasion: Occasion }) {
  const birthday = occasion.kind === "BIRTHDAY";
  const Icon = birthday ? Cake : Heart;
  return (
    <div className="flex items-center gap-3" title={daysText(occasion.daysAway)}>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", birthday ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600")} aria-hidden="true">
        <Icon className="h-[1.15rem] w-[1.15rem]" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-sm font-semibold text-slate-900">{occasion.label}</span>
        <span className="block text-[13px] tabular-nums text-slate-500">
          {formatFullDate(occasion.date)}
          {occasion.daysAway <= 7 && <span className="ml-1.5 font-medium text-brand">· {daysText(occasion.daysAway)}</span>}
        </span>
      </span>
    </div>
  );
}

/** The People list: tick to select, a click on the name opens the profile. */
export function PeopleTable({ people, showAccount, selected, onToggle, onToggleAll, sort, onSort, onOpen, onEdit, onArchive, onDelete }: Props) {
  const all = people.length > 0 && people.every((p) => selected.has(p.id));
  const sortHead = (key: SortKey, label: string, className?: string) => (
    <TableHead className={className} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button type="button" onClick={() => onSort(key)} className="inline-flex items-center gap-1 uppercase hover:text-slate-800">
        {label}{sort.key === key && <span aria-hidden="true">{sort.desc ? "↓" : "↑"}</span>}
      </button>
    </TableHead>
  );
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <Table className="min-w-[64rem]">
        <TableHeader className="bg-slate-50/80">
          <TableRow>
            <TableHead className="w-10 pl-4">
              <input type="checkbox" aria-label="Select all on this page" checked={all} onChange={(e) => onToggleAll(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand" />
            </TableHead>
            {sortHead("name", "Person")}
            {showAccount && <TableHead>Account</TableHead>}
            <TableHead>Relationship</TableHead>
            <TableHead>Contact</TableHead>
            {sortHead("city", "City")}
            {sortHead("nextOccasion", "Next occasion")}
            <TableHead>Profile</TableHead>
            <TableHead className="pr-4 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map((p) => {
            const rel = relationshipOf(p.relationship);
            const occ = p.nextOccasion;
            const pct = p.completeness?.percent ?? 0;
            return (
              <TableRow key={p.id} data-state={selected.has(p.id) ? "selected" : undefined} className={p.status === "ARCHIVED" ? "opacity-70" : undefined}>
                <TableCell className="pl-4">
                  <input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={() => onToggle(p.id)} className="h-4 w-4 rounded border-slate-300 text-brand" />
                </TableCell>
                <TableCell className="py-3">
                  <button type="button" onClick={() => onOpen(p)} className="flex min-w-0 items-center gap-3 text-left">
                    <Avatar src={p.photoUrl} name={p.name} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-slate-900 hover:text-brand">{p.name}{p.status === "ARCHIVED" && <span className="ml-1.5 text-[11px] font-medium text-slate-400">Archived</span>}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[p.designation, p.groups.map((g) => g.name).join(", ")].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                  </button>
                </TableCell>
                {showAccount && <TableCell className="max-w-[12rem] truncate text-slate-600">{p.account?.name ?? "—"}</TableCell>}
                <TableCell>{rel ? <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", rel.tone)}>{rel.label}</span> : <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  <div className="tabular-nums text-slate-700">{mobileText(p.mobileNumber) || "—"}</div>
                  {p.email && <div className="max-w-[12rem] truncate text-slate-400">{p.email}</div>}
                </TableCell>
                <TableCell className="text-slate-600">{p.city || <span className="text-slate-300">—</span>}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {occ ? <OccasionCell occasion={occ} /> : <span className="text-slate-300">—</span>}
                </TableCell>
                <TableCell>
                  <div className="flex w-24 items-center gap-2" title={`Profile ${pct}% complete`}>
                    <span className="h-1.5 flex-1 rounded-full bg-slate-100">
                      <span className={cn("block h-full rounded-full", pct < 50 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
                    </span>
                    <span className="w-8 text-right text-[11px] tabular-nums text-slate-500">{pct}%</span>
                  </div>
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center justify-end gap-0.5">
                    <Tooltip label="Edit"><button type="button" aria-label={`Edit ${p.name}`} onClick={() => onEdit(p)} className="pressable rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Pencil className="h-4 w-4" /></button></Tooltip>
                    <Tooltip label={p.status === "ARCHIVED" ? "Restore" : "Archive"}>
                      <button type="button" aria-label={p.status === "ARCHIVED" ? `Restore ${p.name}` : `Archive ${p.name}`} onClick={() => onArchive(p)} className="pressable rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                        {p.status === "ARCHIVED" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                      </button>
                    </Tooltip>
                    <Tooltip label="Delete" align="end"><button type="button" aria-label={`Delete ${p.name}`} onClick={() => onDelete(p)} className="pressable rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
