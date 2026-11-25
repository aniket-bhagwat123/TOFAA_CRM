"use client";
import { CheckCircle2, Download, FileUp } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { downloadFile } from "@/features/media/download";
import { apiClient, errorMessage } from "@/services/api-client";
import type { ImportResult } from "@/types/people";

type Props = { open: boolean; accounts: { id: string; name: string }[]; defaultCompanyId?: string; onClose: () => void; onDone: () => void };

/** Import people from a spreadsheet into one client: download the template, fill it, upload. Bad rows are listed, not lost. */
export function ImportSheet({ open, accounts, defaultCompanyId, onClose, onDone }: Props) {
  const [companyId, setCompanyId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) { setCompanyId(defaultCompanyId ?? (accounts.length === 1 ? accounts[0].id : "")); setFile(null); setResult(null); setError(""); }
  }, [open, defaultCompanyId, accounts]);

  async function upload() {
    if (!companyId) return setError("Pick the client account");
    if (!file) return setError("Choose the file");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("companyId", companyId);
      form.append("file", file);
      const res = await apiClient.post<ImportResult>("/people/import", form);
      setResult(res.data);
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Import people" subtitle="From an Excel or CSV file" icon={FileUp} tone="sky" onClose={onClose} width="lg">
      {result ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
            <CheckCircle2 className="h-5 w-5" />{result.created} of {result.total} added{result.skipped.length ? `, ${result.skipped.length} skipped` : ""}.
          </p>
          {result.groups.length > 0 && <p className="text-sm text-slate-600">Groups: {result.groups.map((g) => `${g.name} (+${g.added}${g.new ? ", new" : ""})`).join(", ")}</p>}
          {result.skipped.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-700">Skipped rows</p>
              <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 text-sm">
                {result.skipped.map((s) => (
                  <li key={s.row} className="flex gap-3 px-3 py-2"><span className="w-14 shrink-0 text-slate-400">Row {s.row}</span><span className="min-w-0 flex-1"><b className="font-medium text-slate-800">{s.name || "—"}</b> · <span className="text-slate-600">{s.reason}</span></span></li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2"><Button variant="secondary" onClick={() => { setResult(null); setFile(null); }}>Import another file</Button><Button onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-4">
          <ol className="space-y-1 text-sm text-slate-600">
            <li>1. Download the template and fill one person per row (Name and Mobile Number are needed).</li>
            <li>2. Upload it here. People already in this client (same mobile or email) are skipped.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void downloadFile("/people/template", { format: "xlsx" }, "people-import-template.xlsx")}><Download className="h-4 w-4" />Template (.xlsx)</Button>
            <Button variant="ghost" onClick={() => void downloadFile("/people/template", { format: "csv" }, "people-import-template.csv")}>CSV template</Button>
          </div>
          {accounts.length > 1 && (
            <SelectField label="Client account" required placeholder="Select" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setError(""); }} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
          )}
          <label className="pressable flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600 hover:border-brand hover:bg-brand-soft/40">
            <FileUp className="h-5 w-5" />
            <span className="font-medium">{file ? file.name : "Choose a .xlsx, .xls or .csv file"}</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(""); }} />
          </label>
          {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
          <Button onClick={() => void upload()} loading={busy} className="w-full">Import</Button>
        </div>
      )}
    </Sheet>
  );
}
