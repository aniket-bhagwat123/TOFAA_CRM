"use client";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, FileText, FileUp, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select-field";
import { useApi } from "@/hooks/use-api";
import { canAssignLeads } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { AssignableUser } from "@/types/crm";

const FIELDS = [
  { key: "companyName", label: "Company", required: true, hints: ["company", "organisation", "organization", "firm", "business"] },
  { key: "contactName", label: "Contact name", required: true, hints: ["contact", "name", "person"] },
  { key: "phone", label: "Phone", required: false, hints: ["phone", "mobile", "contact no", "number", "whatsapp"] },
  { key: "email", label: "Email", required: false, hints: ["email", "e-mail", "mail"] },
  { key: "source", label: "Lead source", required: false, hints: ["source"] },
  { key: "designation", label: "Designation", required: false, hints: ["designation", "title", "role"] },
  { key: "city", label: "City", required: false, hints: ["city", "location", "town"] },
  { key: "valueBand", label: "Rough value", required: false, hints: ["value", "budget", "band"] },
  { key: "notes", label: "Notes", required: false, hints: ["note", "remark", "comment"] },
] as const;

const SAMPLES = [
  { label: "CSV", file: "tofaa-leads-sample.csv", icon: FileText },
  { label: "Excel (.xlsx)", file: "tofaa-leads-sample.xlsx", icon: FileSpreadsheet },
  { label: "Excel 97-2003 (.xls)", file: "tofaa-leads-sample.xls", icon: FileSpreadsheet },
  { label: "PDF guide", file: "tofaa-leads-sample.pdf", icon: FileText },
] as const;

type Parsed = { headers: string[]; rows: Record<string, string>[]; total: number };
type Analysed = {
  row: number;
  data: Record<string, string | null>;
  errors: string[];
  duplicate: { matchedOn: string[]; ownerName?: string | null; canMerge: boolean; inFile: boolean; firstRow?: number } | null;
};
type Preview = { rows: Analysed[]; summary: { total: number; valid: number; invalid: number; duplicates: number } };
type Result = { created: number; merged: number; skippedDuplicates: number; invalid: number };
type Step = "upload" | "map" | "review" | "done";

const STEPS: { key: Exclude<Step, "done">; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "map", label: "Match columns" },
  { key: "review", label: "Review" },
];

function guess(headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const map: Record<string, string> = {};
  for (const f of FIELDS) {
    const hit = headers.find((h) => !used.has(h) && f.hints.some((x) => h.toLowerCase().includes(x)));
    if (hit) { map[f.key] = hit; used.add(hit); }
  }
  return map;
}

type Props = { open: boolean; onClose: () => void; onImported: () => void };

/** The whole import in one dialog: get a sample, upload, match columns, review problems, import. */
export function ImportModal({ open, onClose, onImported }: Props) {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const assigner = !!user && canAssignLeads(user.role);
  const people = useApi<AssignableUser[]>(open && assigner ? "/users/assignable" : null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [onDup, setOnDup] = useState<"skip" | "merge">("skip");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setStep("upload"); setParsed(null); setFileName(""); setMap({}); setPreview(null); setOnDup("skip");
    setOwner(""); setResult(null); setMapError(null); setDragging(false);
  }, [open]);

  const mappedRows = () => parsed!.rows.map((r) => Object.fromEntries(FIELDS.map((f) => [f.key, map[f.key] ? r[map[f.key]] ?? "" : ""])));

  async function upload(file?: File) {
    if (!file) return;
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) return toast.error("Upload a .csv, .xlsx or .xls file.");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiClient.post<Parsed>("/imports/parse", form);
      setParsed(res.data);
      setFileName(file.name);
      setMap(guess(res.data.headers));
      setPreview(null);
      setStep("map");
    } catch (e) {
      toast.error(errorMessage(e, "Could not read that file."));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function runPreview() {
    const missing = FIELDS.filter((f) => f.required && !map[f.key]).map((f) => f.label);
    if (missing.length) return setMapError(`Choose a column for: ${missing.join(", ")}.`);
    if (!map.phone && !map.email) return setMapError("Choose a Phone or an Email column. Each lead needs at least one.");
    setMapError(null);
    setBusy(true);
    try {
      const res = await apiClient.post<Preview>("/imports/preview", { rows: mappedRows(), ownerId: owner || null }, { timeout: 60000 });
      setPreview(res.data);
      setStep("review");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    try {
      const res = await apiClient.post<Result>("/imports/commit", { rows: mappedRows(), ownerId: owner || null, onDuplicate: onDup }, { timeout: 120000 });
      setResult(res.data);
      setStep("done");
      onImported();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <Modal open={open} onClose={onClose} title="Import leads" subtitle="Bring in your existing sheet in a few minutes" icon={FileUp} tone="violet">
      {step !== "done" && (
        <ol className="mb-6 flex items-center gap-2 text-sm" aria-label="Import steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", i <= stepIndex ? "bg-brand text-white" : "bg-slate-200 text-slate-500")}>{i + 1}</span>
              <span className={cn("font-medium", i === stepIndex ? "text-slate-900" : "text-slate-400")}>{s.label}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-slate-200" />}
            </li>
          ))}
        </ol>
      )}

      {step === "upload" && (
        <div className="space-y-6">
          <section>
            <h3 className="text-sm font-semibold text-slate-700">1. Start from a sample (optional)</h3>
            <p className="mt-0.5 text-sm text-slate-500">It shows the columns we expect and a few example rows. The PDF is a printable guide.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {SAMPLES.map(({ label, file, icon: Icon }) => (
                <a key={file} href={`/samples/${file}`} download className="pressable flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 hover:border-brand/40 hover:bg-brand-soft">
                  <Icon className="h-5 w-5 text-brand" /> <span className="flex-1">{label}</span> <Download className="h-4 w-4 text-slate-400" />
                </a>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-700">2. Upload your file</h3>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => void upload(e.target.files?.[0])} />
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files?.[0]); }}
              className={cn("mt-3 flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors", dragging ? "border-brand bg-brand-soft" : "border-slate-300 bg-slate-50")}
            >
              <UploadCloud className="h-10 w-10 text-brand" />
              <div>
                <p className="font-medium text-slate-800">Drag your file here</p>
                <p className="text-sm text-slate-500">CSV, Excel (.xlsx) or Excel 97-2003 (.xls) · up to 2000 rows · 5 MB</p>
              </div>
              <Button loading={busy} onClick={() => fileRef.current?.click()}>Choose file</Button>
            </div>
          </section>
        </div>
      )}

      {step === "map" && parsed && (
        <div className="space-y-5">
          <p className="text-sm text-slate-600"><b>{fileName}</b> · {parsed.total} rows found. Match your columns to ours. We guessed what we could.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <SelectField
                key={f.key}
                label={f.label}
                required={f.required}
                placeholder="Not in my file"
                value={map[f.key] ?? ""}
                options={parsed.headers.map((h) => ({ value: h, label: h }))}
                onChange={(e) => { setMap((m) => ({ ...m, [f.key]: e.target.value })); setMapError(null); }}
              />
            ))}
          </div>
          {assigner && (
            <SelectField label="Assign imported leads to" placeholder="Me" value={owner} options={(people.data ?? []).map((u) => ({ value: u.id, label: u.fullName ?? u.id }))} onChange={(e) => setOwner(e.target.value)} />
          )}
          {mapError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{mapError}</p>}
          <div className="flex justify-between gap-2 pt-1">
            <Button variant="ghost" onClick={() => setStep("upload")}><ArrowLeft className="h-4 w-4" /> Back</Button>
            <Button loading={busy} onClick={runPreview}>Review</Button>
          </div>
        </div>
      )}

      {step === "review" && preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">{preview.summary.valid} ready</span>
            <span className="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700">{preview.summary.duplicates} duplicates</span>
            <span className="rounded-full bg-red-50 px-3 py-1 font-medium text-red-700">{preview.summary.invalid} with errors</span>
          </div>
          {preview.summary.duplicates > 0 && (
            <SelectField
              label="When a lead already exists"
              value={onDup}
              onChange={(e) => setOnDup(e.target.value as "skip" | "merge")}
              options={[{ value: "skip", label: "Skip it" }, { value: "merge", label: "Merge: fill the gaps on the existing lead" }]}
            />
          )}
          <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr><th className="p-2">Row</th><th className="p-2">Company</th><th className="p-2">Contact</th><th className="p-2">Phone / email</th><th className="p-2">Status</th></tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row} className={cn("border-t border-slate-100", r.errors.length ? "bg-red-50/60" : r.duplicate ? "bg-amber-50/60" : "")}>
                    <td className="p-2">{r.row + 1}</td>
                    <td className="p-2">{r.data.companyName}</td>
                    <td className="p-2">{r.data.contactName}</td>
                    <td className="p-2">{r.data.phone ?? r.data.email}</td>
                    <td className="p-2">
                      {r.errors.length ? r.errors.join("; ")
                        : r.duplicate ? (r.duplicate.inFile ? `Duplicate of row ${(r.duplicate.firstRow ?? 0) + 1}` : `Exists${r.duplicate.ownerName ? ` · owner ${r.duplicate.ownerName}` : ""} (${r.duplicate.matchedOn.join(", ")})`)
                        : "Ready"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("map")}><ArrowLeft className="h-4 w-4" /> Back</Button>
            <Button loading={busy} onClick={commit} disabled={preview.summary.valid === 0 && !(onDup === "merge" && preview.summary.duplicates > 0)}>
              Import {preview.summary.valid} {preview.summary.valid === 1 ? "lead" : "leads"}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="h-14 w-14 text-emerald-500" />
          <h3 className="text-xl font-semibold tracking-tight">Import finished</h3>
          <p className="text-sm text-slate-600">{result.created} added · {result.merged} merged · {result.skippedDuplicates} duplicates skipped · {result.invalid} with errors skipped</p>
          <p className="text-xs text-slate-500">Each new lead has a first follow-up for the next business day.</p>
          <Button onClick={onClose} className="mt-2">View leads</Button>
        </div>
      )}
    </Modal>
  );
}
