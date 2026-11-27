"use client";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDebounce } from "@/hooks/use-debounce";
import type { ModuleConfig, ModuleField } from "@/features/modules/module-config";
import { formatCell, labelFor } from "@/features/modules/module-utils";
import { getModuleRecords, mutateModule } from "@/features/modules/module.service";
import { cleanPayload } from "@/features/forms/form.service";
import { errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { ApiRecord, Page } from "@/types/api";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { DeleteDialog } from "../ui/delete-dialog";
import { EmptyState } from "../ui/empty-state";
import { FormPanel } from "../ui/form-panel";
import { InputField, TextareaField } from "../ui/input-field";
import { PageHeader } from "../ui/page-header";
import { SearchInput } from "../ui/search-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "../ui/status-badge";

function RecordForm({ fields, initial, onSubmit, saving }: {
  fields: ModuleField[]; initial?: ApiRecord; saving: boolean; onSubmit: (v: Record<string, unknown>) => void;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const values: Record<string, unknown> = {};
        for (const f of fields) {
          const raw = String(fd.get(f.name) ?? "");
          values[f.name] = f.type === "number" && raw !== "" ? Number(raw) : raw;
        }
        onSubmit(cleanPayload(values));
      }}
    >
      {fields.map((f) => {
        const common = { key: f.name, name: f.name, label: f.label, required: f.required, defaultValue: (initial?.[f.name] as string | number | undefined) ?? "" };
        return f.type === "textarea"
          ? <TextareaField {...common} />
          : <InputField {...common} type={f.type} step={f.type === "number" ? "0.01" : undefined} />;
      })}
      <Button type="submit" loading={saving} className="w-full">Save</Button>
    </form>
  );
}

export function ModuleList({ config }: { config: ModuleConfig }) {
  const user = useAppSelector((s) => s.auth.session!.profile);
  const endpoint = config.endpoint(user);

  const [data, setData] = useState<Page<ApiRecord> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search);
  const [editing, setEditing] = useState<ApiRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<ApiRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getModuleRecords(endpoint, { page, limit: config.pageSize ?? 20, search: debounced || undefined }));
    } catch (e) {
      setError(errorMessage(e, "Could not load records."));
    } finally {
      setLoading(false);
    }
  }, [endpoint, page, debounced, config.pageSize]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [debounced]);

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      setEditing(null);
      setDeleting(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const save = (values: Record<string, unknown>) =>
    editing === "new"
      ? run(() => mutateModule("post", endpoint, values, { "Idempotency-Key": crypto.randomUUID() }), "Created.")
      : run(() => {
          const rec = editing as ApiRecord;
          const url = config.updateEndpoint?.(endpoint, rec) ?? `${endpoint}/${rec.id}`;
          return mutateModule(config.updateMethod ?? "patch", url, { ...values, version: rec.version });
        }, "Saved.");

  const canCreate = !!config.createFields;
  const singular = config.singular ?? "record";

  return (
    <div>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={canCreate && <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New {singular}</Button>}
      />
      <Card>
        <div className="mb-4"><SearchInput value={search} onChange={setSearch} /></div>
        {loading && !data ? (
          <TableSkeleton columns={4} rows={6} bare />
        ) : error ? (
          <div className="py-8 text-center text-sm text-red-600">{error} <button className="underline" onClick={load}>Retry</button></div>
        ) : !data?.items.length ? (
          <EmptyState title={`No ${config.title.toLowerCase()} yet`} hint={config.emptyHint} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    {config.columns.map((c) => <th key={c} className="px-3 py-2">{labelFor(c)}</th>)}
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      {config.columns.map((c) => (
                        <td key={c} className="px-3 py-2">
                          {c === "status" ? <StatusBadge status={String(row[c])} /> : formatCell(row, c)}
                        </td>
                      ))}
                      <td className="flex justify-end gap-1 px-3 py-2">
                        {config.actions?.(row, user).map((a) => (
                          <Button key={a.label} variant={a.tone === "danger" ? "danger" : "secondary"} className="px-2 py-1 text-xs"
                            onClick={() => run(() => mutateModule("post", a.path), `${a.label} done.`)}>{a.label}</Button>
                        ))}
                        {config.updateFields && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(row)}>Edit</Button>}
                        {config.deletePath !== undefined ? (
                          <Button variant="ghost" className="px-2 py-1 text-xs text-red-600" onClick={() => setDeleting(row)}>Delete</Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
              <span>Page {data.page} of {data.pages} · {data.total} total</span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <FormPanel open={editing !== null} title={editing === "new" ? `New ${singular}` : `Edit ${singular}`} width={config.modalWidth} onClose={() => setEditing(null)}>
        {editing && (
          <RecordForm
            key={editing === "new" ? "new" : (editing as ApiRecord).id}
            fields={(editing === "new" ? config.createFields : config.updateFields) ?? []}
            initial={editing === "new" ? undefined : editing}
            saving={busy}
            onSubmit={save}
          />
        )}
      </FormPanel>

      <DeleteDialog
        open={!!deleting}
        title={`Delete ${singular}?`}
        message="This cannot be undone."
        loading={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && run(() => mutateModule("delete", config.deletePath?.(endpoint, deleting.id) ?? `${endpoint}/${deleting.id}`), "Deleted.")}
      />
    </div>
  );
}
