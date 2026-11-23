"use client";
import { Check, Download, FileSignature, Layers, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { openPdf } from "@/features/media/download";
import { useApi } from "@/hooks/use-api";
import { fieldErrors } from "@/lib/api-errors";
import { inr } from "@/lib/money";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { AgreementTerm, DealData, QuotationPhoto } from "@/types/crm";
import {
  blankPackage, fromPackages, fromQuotation, MAX_PACKAGE_PHOTOS, MAX_PHOTO_BYTES, OUTLINE_BTN, PackageCard, packageErrors, packagesPayload,
  PHOTO_TYPES, type PackageDraft,
} from "./quotation-sheet";
import type { LeadTarget } from "./types";

type TermDraft = AgreementTerm & { key: number };

// Scope of work ticked on a new agreement (the usual full-service job).
const DEFAULT_SCOPE = ["curation_design", "custom_branding", "sourcing_manufacturing", "quality_control", "custom_packaging", "individual_shipping"];
const SECTION = "text-xs font-semibold uppercase tracking-wide text-slate-800";
const TILE = "rounded-xl border border-slate-200 bg-slate-50/70 p-3";

let termKey = 1;
const withKeys = (terms: AgreementTerm[]): TermDraft[] => terms.map((t) => ({ ...t, key: termKey++ }));

/** Totals the same way the server works them out: GST on base + transportation. */
function totalsFor(packages: PackageDraft[], transport: string, gstRate: number) {
  const units = packages.reduce((n, p) => n + (Number(p.quantity) || 0), 0);
  const base = packages.reduce((n, p) => n + (Number(p.quantity) || 0) * (Number(p.unitPrice) || 0), 0);
  const transportation = Number(transport) || 0;
  const gst = Math.round((base + transportation) * gstRate) / 100;
  return { units, base, avg: units ? base / units : 0, transportation, gst, total: base + transportation + gst };
}

type Props = { target: LeadTarget | null; onClose: () => void; onDone: () => void };

/**
 * Prepare the agreement: packages, scope, commercials, terms and signees, then download the PDF.
 * Saving it is the action that moves the lead to Agreement and Payment.
 */
export function AgreementSheet({ target, onClose, onDone }: Props) {
  const deal = useApi<DealData>(target ? `/leads/${target.leadId}/deal` : null);
  const [packages, setPackages] = useState<PackageDraft[]>([]);
  const [scope, setScope] = useState<string[]>(DEFAULT_SCOPE);
  const [scopeOther, setScopeOther] = useState("");
  const [transport, setTransport] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [terms, setTerms] = useState<TermDraft[]>([]);
  const [tofaaSignee, setTofaaSignee] = useState("");
  const [clientSignee, setClientSignee] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState<"save" | "pdf" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const loadedFor = useRef<string | null>(null);

  const ag = deal.data?.agreement;
  const options = ag?.options;
  const defaultTerms = options?.defaultTerms ?? [];

  // Fill once per opening: the saved agreement, or a new one from the latest quotation.
  useEffect(() => {
    if (!target || !deal.data || loadedFor.current === target.leadId) return;
    loadedFor.current = target.leadId;
    const d = deal.data.agreement.details;
    const quote = deal.data.quotations[0];
    if (d) {
      setPackages(fromPackages(d.packages));
      setScope(d.scope); setScopeOther(d.scopeOther ?? ""); setTransport(d.transportation ? String(d.transportation) : "");
      setGstRate(d.gstRate); setTerms(withKeys(d.terms)); setTofaaSignee(d.tofaaSignee ?? ""); setClientSignee(d.clientSignee ?? ""); setRemarks(d.remarks ?? "");
    } else {
      const fromQuote = quote ? fromQuotation(quote) : [];
      setPackages(fromQuote.length ? fromQuote : [blankPackage()]);
      setTerms(withKeys(deal.data.agreement.options?.defaultTerms ?? []));
      setClientSignee(target.name.split(" · ")[1] ?? "");
    }
  }, [target, deal.data]);

  useEffect(() => {
    if (target) return;
    loadedFor.current = null;
    setPackages([]); setScope(DEFAULT_SCOPE); setScopeOther(""); setTransport(""); setGstRate(18); setTerms([]);
    setTofaaSignee(""); setClientSignee(""); setRemarks(""); setErrors({});
  }, [target]);

  const t = totalsFor(packages, transport, gstRate);
  const uploading = packages.some((p) => p.uploading > 0);
  const clear = (k: string) => setErrors((e) => ({ ...e, [k]: "" }));

  const patchPackage = (key: number, fn: (p: PackageDraft) => Partial<PackageDraft>) => {
    setPackages((all) => all.map((p) => (p.key === key ? { ...p, ...fn(p) } : p)));
    setErrors((e) => ({ ...e, [`pkg-${key}`]: "", packages: "" }));
  };

  async function uploadPhotos(key: number, files: File[]) {
    if (!target) return;
    const pkg = packages.find((p) => p.key === key);
    if (!pkg) return;
    const good = files.filter((f) => {
      if (!PHOTO_TYPES.includes(f.type)) { toast.error(`${f.name}: use a JPEG, PNG or WebP image`); return false; }
      if (f.size > MAX_PHOTO_BYTES) { toast.error(`${f.name}: each photo must be 5 MB or smaller`); return false; }
      return true;
    });
    const batch = good.slice(0, Math.max(MAX_PACKAGE_PHOTOS - pkg.photos.length - pkg.uploading, 0));
    if (!batch.length) return;
    patchPackage(key, (p) => ({ uploading: p.uploading + batch.length }));
    await Promise.all(batch.map(async (f) => {
      try {
        const form = new FormData();
        form.append("file", f);
        const res = await apiClient.post<QuotationPhoto>(`/leads/${target.leadId}/quotation-photos`, form, { timeout: 60000 });
        patchPackage(key, (p) => ({ photos: [...p.photos, res.data], uploading: p.uploading - 1 }));
      } catch (err) {
        toast.error(`${f.name}: ${errorMessage(err)}`);
        patchPackage(key, (p) => ({ uploading: p.uploading - 1 }));
      }
    }));
  }

  /** Checks and saves the prepared agreement. Returns false when something needs fixing. */
  async function saveDetails(): Promise<boolean> {
    if (!target) return false;
    const e = packageErrors(packages);
    if (!Object.keys(e).length && t.total <= 0) e.packages = "The total must be greater than 0";
    if (scope.includes("other") && !scopeOther.trim()) e.scopeOther = "Describe the other work";
    terms.forEach((x, n) => { if (!x.title.trim() || !x.body.trim()) e[`term-${x.key}`] = `Term ${n + 1} needs a title and text`; });
    setErrors(e);
    if (Object.keys(e).length) { toast.error("Some details need fixing"); return false; }
    if (uploading) { toast.info("Wait for the photos to finish uploading"); return false; }
    try {
      await apiClient.put(`/leads/${target.leadId}/agreement/details`, {
        packages: packagesPayload(packages), scope, scopeOther: scope.includes("other") ? scopeOther.trim() : null,
        transportation: Number(transport) || 0, gstRate, terms: terms.map(({ title, body }) => ({ title: title.trim(), body: body.trim() })),
        tofaaSignee: tofaaSignee.trim() || null, clientSignee: clientSignee.trim() || null, remarks: remarks.trim() || null,
      });
      return true;
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe);
      toast.error(errorMessage(err));
      return false;
    }
  }

  async function save() {
    setBusy("save");
    try {
      if (await saveDetails()) { toast.success("Agreement saved. The lead is in Agreement and Payment."); void deal.reload(); onDone(); onClose(); }
    } finally { setBusy(null); }
  }

  async function saveAndDownload() {
    if (!target) return;
    setBusy("pdf");
    try {
      if (!(await saveDetails())) return;
      void deal.reload();
      onDone();
      await openPdf(`/leads/${target.leadId}/agreement/pdf`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally { setBusy(null); }
  }

  return (
    <Sheet open={!!target} title="Agreement" subtitle={target?.name} icon={FileSignature} tone="amber" onClose={onClose} width="xl">
      {deal.loading && !deal.data ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="space-y-5">
          <>
              {/* requirement packages */}
              <section className="space-y-3">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <h3 className={cn(SECTION, "flex items-center gap-2")}><Layers className="h-4 w-4 text-brand" aria-hidden="true" /> Client requirement packages ({packages.length})</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Taken from the latest quotation. Each requirement holds its own unit pricing, gifting items and approved visual mockups.</p>
                  </div>
                  <button type="button" className={OUTLINE_BTN} onClick={() => setPackages((all) => [...all, blankPackage()])}><Plus className="h-3.5 w-3.5" /> Add requirement</button>
                </div>
                {packages.map((p, n) => (
                  <PackageCard key={p.key} index={n} pkg={p} error={errors[`pkg-${p.key}`]} canRemove={packages.length > 1}
                    onPatch={(fn) => patchPackage(p.key, fn)} onRemove={() => setPackages((all) => all.filter((x) => x.key !== p.key))} onUpload={(f) => void uploadPhotos(p.key, f)} />
                ))}
                {errors.packages && <p role="alert" className="text-xs font-medium text-red-600">{errors.packages}</p>}
              </section>

              {/* scope of work */}
              <section className="space-y-2">
                <h3 className={SECTION}>Scope of work</h3>
                <div className="grid gap-x-4 gap-y-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  {(options?.scope ?? []).map((o) => {
                    const on = scope.includes(o.value);
                    return (
                      <label key={o.value} className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
                        <input type="checkbox" className="sr-only" checked={on} onChange={() => { setScope((s) => (on ? s.filter((x) => x !== o.value) : [...s, o.value])); clear("scopeOther"); }} />
                        <span aria-hidden="true" className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}>
                          {on && <Check className="h-3.5 w-3.5" />}
                        </span>
                        {o.label}
                      </label>
                    );
                  })}
                </div>
                {scope.includes("other") && (
                  <InputField label="Other work" required value={scopeOther} maxLength={120} onChange={(e) => { setScopeOther(e.target.value); clear("scopeOther"); }} error={errors.scopeOther} />
                )}
              </section>

              {/* commercials */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className={SECTION}>Project cost & commercials</h3>
                  <p className="text-xs text-slate-500">Volume and base rates are calculated from the requirement packages above.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className={TILE}><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total target volume</div><div className="mt-1 font-mono text-lg font-bold text-slate-900">{t.units.toLocaleString("en-IN")} pcs</div><div className="text-xs text-slate-400">Sum of all packages</div></div>
                  <div className={TILE}><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Base subtotal</div><div className="mt-1 font-mono text-lg font-bold text-slate-900">{inr(t.base)}</div><div className="text-xs text-slate-400">Excl. logistics & GST</div></div>
                  <div className={TILE}><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Effective avg rate</div><div className="mt-1 font-mono text-lg font-bold text-slate-900">{inr(Math.round(t.avg))} / unit</div><div className="text-xs text-slate-400">Weighted avg</div></div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <InputField label="Transportation (₹)" type="number" placeholder="0" value={transport} onChange={(e) => setTransport(e.target.value)} />
                  <SelectField label="GST rate" value={String(gstRate)} onChange={(e) => setGstRate(Number(e.target.value))} options={(options?.gstRates ?? [0, 5, 12, 18, 28]).map((r) => ({ value: String(r), label: `${r}%` }))} />
                </div>
                <div className="space-y-1 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                  <div className="flex justify-between text-slate-500"><span>Base subtotal</span><span className="tabular-nums">{inr(t.base)}</span></div>
                  {t.transportation > 0 && <div className="flex justify-between text-slate-500"><span>Transportation</span><span className="tabular-nums">{inr(t.transportation)}</span></div>}
                  <div className="flex justify-between text-slate-500"><span>GST ({gstRate}%)</span><span className="tabular-nums">{inr(t.gst)}</span></div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900"><span>Total project cost</span><span className="tabular-nums">{t.total > 0 ? inr(t.total) : "—"}</span></div>
                </div>
              </section>

              {/* terms */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className={SECTION}>Core contract terms & policies <span className="font-normal normal-case text-slate-400">({terms.length} active {terms.length === 1 ? "clause" : "clauses"})</span></h3>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setTerms(withKeys(defaultTerms))} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"><RotateCcw className="h-3 w-3" /> Reset defaults</button>
                    <button type="button" disabled={terms.length >= 20} onClick={() => setTerms((x) => [...x, { key: termKey++, title: "", body: "" }])} className="pressable inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                      <Plus className="h-3.5 w-3.5" /> Add custom term
                    </button>
                  </div>
                </div>
                {terms.map((term, n) => (
                  <div key={term.key} className={cn("space-y-2 rounded-2xl border bg-slate-50/70 p-3", errors[`term-${term.key}`] ? "border-red-300" : "border-slate-200")}>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded-md bg-slate-200/70 px-2 py-1 text-xs font-semibold tabular-nums text-slate-600">{String(n + 1).padStart(2, "0")}</span>
                      <div className="min-w-0 flex-1">
                        <InputField hideLabel label={`Term ${n + 1} title`} placeholder="Term title" maxLength={120} value={term.title} onChange={(e) => { setTerms((x) => x.map((y) => (y.key === term.key ? { ...y, title: e.target.value } : y))); clear(`term-${term.key}`); }} className="h-9 rounded-lg px-2.5 py-1.5 font-semibold sm:text-sm" />
                      </div>
                      <button type="button" aria-label={`Remove term ${n + 1}`} onClick={() => setTerms((x) => x.filter((y) => y.key !== term.key))} className="pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <TextareaField label={`Term ${n + 1} text`} rows={2} maxLength={1000} value={term.body} onChange={(e) => { setTerms((x) => x.map((y) => (y.key === term.key ? { ...y, body: e.target.value } : y))); clear(`term-${term.key}`); }} />
                    {errors[`term-${term.key}`] && <p role="alert" className="text-xs font-medium text-red-600">{errors[`term-${term.key}`]}</p>}
                  </div>
                ))}
              </section>

              {/* signees */}
              <section className="grid gap-3 sm:grid-cols-3">
                <InputField label="TOFAA signee" placeholder="TOFAA representative" maxLength={120} value={tofaaSignee} onChange={(e) => setTofaaSignee(e.target.value)} />
                <InputField label="Client signee" placeholder="Client representative" maxLength={120} value={clientSignee} onChange={(e) => setClientSignee(e.target.value)} />
                <InputField label="Remarks" placeholder="Any additional conditions" maxLength={1000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </section>

              {/* summary + actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50/60 px-4 py-3 text-sm">
                <span className="text-slate-500">Total units: <b className="text-slate-800">{t.units ? t.units.toLocaleString("en-IN") : "—"}</b><span className="mx-3 text-slate-300">|</span>Base cost: <b className="text-slate-800">{inr(t.base)}</b></span>
                <span className="font-mono text-lg font-bold text-red-700">{t.total > 0 ? inr(t.total) : "—"}</span>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="secondary" onClick={save} loading={busy === "save"} disabled={!!busy || uploading} className="sm:flex-1">Save agreement</Button>
                <Button onClick={saveAndDownload} loading={busy === "pdf"} disabled={!!busy || uploading} className="sm:flex-[2]"><Download className="h-4 w-4" /> Save and download PDF</Button>
              </div>
            </>
        </div>
      )}
    </Sheet>
  );
}
