"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AUDIENCE_LABEL, BannerSheet } from "@/components/banners/banner-sheet";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { useApi } from "@/hooks/use-api";
import { formatDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { Banner } from "@/types/people";

/** Where a banner stands today: live, waiting for its start date, past its end date, or switched off. */
function state(b: Banner): { label: string; tone: string } {
  const today = todayIso();
  if (!b.isActive) return { label: "Off", tone: "bg-slate-100 text-slate-600" };
  if (b.startsOn && b.startsOn > today) return { label: `From ${formatDate(b.startsOn)}`, tone: "bg-sky-50 text-sky-700" };
  if (b.endsOn && b.endsOn < today) return { label: "Ended", tone: "bg-amber-50 text-amber-800" };
  return { label: "Live", tone: "bg-emerald-50 text-emerald-700" };
}

/** Banners (KAM and admin): pictures shown as a rotating strip at the top of the Dashboard. */
export default function BannersPage() {
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const router = useRouter();
  const allowed = role === "admin" || role === "kam";
  const list = useApi<Banner[]>(allowed ? "/admin/banners" : null);
  const [editing, setEditing] = useState<Banner | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Banner | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (role && !allowed) router.replace("/dashboard"); }, [role, allowed, router]);
  if (!allowed) return null;
  const reload = () => void list.reload();

  async function toggle(b: Banner) {
    setBusy(b.id);
    try {
      await apiClient.patch(`/admin/banners/${b.id}`, { isActive: !b.isActive });
      toast.success(b.isActive ? "Banner switched off" : "Banner switched on");
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(removing.id);
    try {
      await apiClient.delete(`/admin/banners/${removing.id}`);
      toast.success("Banner deleted");
      setRemoving(null);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Banners" description="Pictures (the 1000 × 90 shape) shown at the top of the Dashboard. Add, order, schedule or switch them off."
        actions={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add banner</Button>} />

      {list.loading && !list.data && <div className="flex justify-center py-12"><Spinner /></div>}
      {list.error && !list.data && <StateView kind="error" message={list.error} onRetry={reload} />}
      {list.data && list.data.length === 0 && (
        <StateView kind="empty" title="No banners yet" message="Upload a banner picture to show it on the Dashboard." action={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add banner</Button>} />
      )}
      {list.data && list.data.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
          <Table className="min-w-[52rem]">
            <TableHeader className="bg-slate-50/80">
              <TableRow>
                <TableHead className="pl-4">Banner</TableHead>
                <TableHead>Who sees it</TableHead>
                <TableHead className="text-right">Order</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((b) => {
                const s = state(b);
                return (
                  <TableRow key={b.id}>
                    <TableCell className="py-3 pl-4">
                      <div className="space-y-1">
                        {b.imageUrl
                          // eslint-disable-next-line @next/next/no-img-element -- a signed storage link
                          ? <img src={b.imageUrl} alt={b.title || "Banner"} className="h-9 w-auto max-w-[22rem] rounded border border-slate-200" />
                          : <span className="text-xs text-slate-400">Picture unavailable</span>}
                        {b.title && <div className="truncate text-xs text-slate-500">{b.title}</div>}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-700">{AUDIENCE_LABEL[b.audience]}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.sortOrder}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-600">
                      {b.startsOn || b.endsOn ? `${b.startsOn ? formatDate(b.startsOn) : "Now"} – ${b.endsOn ? formatDate(b.endsOn) : "no end"}` : "Always"}
                    </TableCell>
                    <TableCell><span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", s.tone)}>{s.label}</span></TableCell>
                    <TableCell className="pr-4">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip label={b.isActive ? "Switch off" : "Switch on"}>
                          <button type="button" role="switch" aria-checked={b.isActive} aria-label={b.isActive ? "Switch off" : "Switch on"} disabled={busy === b.id} onClick={() => void toggle(b)}
                            className={cn("relative h-5 w-9 rounded-full transition-colors disabled:opacity-50", b.isActive ? "bg-brand" : "bg-slate-300")}>
                            <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", b.isActive ? "left-[1.125rem]" : "left-0.5")} />
                          </button>
                        </Tooltip>
                        <Tooltip label="Edit"><button type="button" aria-label="Edit" onClick={() => setEditing(b)} className="pressable rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Pencil className="h-4 w-4" /></button></Tooltip>
                        <Tooltip label="Delete" align="end"><button type="button" aria-label="Delete" onClick={() => setRemoving(b)} className="pressable rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <BannerSheet open={adding || !!editing} banner={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={reload} />
      <DeleteDialog open={!!removing} title="Delete this banner?" message="It disappears from every Dashboard and its picture is removed." loading={busy === removing?.id}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)} />
    </div>
  );
}
