"use client";
/**
 * Add or edit a recipient: Gifting OS's side panel with steps (Recipient Details, Occasions, Preferences & Delivery,
 * Review & Save), in the CRM's colours. Adding asks for the address only; preferences appear when editing.
 */
import { ArrowLeft, ArrowRight, Check, CheckCircle2, UserPlus, UserRoundPen, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorData, fieldErrors, statusOf } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { Duplicate, PeopleGroup, Person } from "@/types/people";
import { DuplicateFound, findDuplicates, loadForEdit, saveEdit, saveNew, type SaveResult } from "./save";
import { AddressSection, DetailsStep, type OccasionsHandle, OccasionsStep, PreferencesFields, ReviewStep } from "./steps";
import { clearDraft, draftKey, type Details, EMPTY, type Errors, hasContent, loadDraft, type SavedDraft, storeDraft, validateAddresses, validateDetails, type WizardData } from "./types";

const LAST = 3;

type Props = {
  open: boolean;
  person: Person | null; // editing this one; null = adding
  accounts: { id: string; name: string }[];
  defaultCompanyId?: string; // the account chosen in the list filter
  onClose: () => void;
  onSaved: () => void;
};

/** Numbered steps joined by a line. A finished step shows a tick and can be clicked to go back. */
function Stepper({ steps, current, reached, onGo }: { steps: string[]; current: number; reached: number; onGo: (s: number) => void }) {
  return (
    <nav aria-label="Add recipient progress">
      <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((label, i) => {
          const active = i === current, done = i < current, open = i <= reached && !active;
          return (
            <li key={label} className="relative flex min-w-0 flex-col items-center">
              {i > 0 && <span aria-hidden="true" className={cn("absolute right-1/2 top-4 h-px w-full", i <= reached ? "bg-brand/50" : "bg-slate-200")} />}
              <button type="button" disabled={!open} onClick={() => onGo(i)} aria-current={active ? "step" : undefined} className="relative z-10 flex min-w-0 flex-col items-center gap-1.5 disabled:cursor-default">
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold", active || done ? "border-brand bg-brand text-white" : open ? "border-brand/50 bg-white text-brand" : "border-slate-300 bg-white text-slate-500")}>
                  {done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn("max-w-full truncate border-b-2 px-1 pb-1.5 text-xs font-medium", active ? "border-brand font-semibold text-brand" : "hidden border-transparent text-slate-500 sm:block")}>{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-center text-xs font-semibold text-brand sm:hidden">Step {current + 1} of {steps.length}</p>
    </nav>
  );
}

/** The panel at the right of the screen: header, steps, the form that scrolls, and a footer that stays. */
function SidePanel({ title, description, icon, stepper, footer, onSubmit, onClose, children }: {
  title: string; description: string; icon: ReactNode; stepper?: ReactNode; footer: ReactNode; onSubmit?: (e: FormEvent) => void; onClose: () => void; children: ReactNode;
}) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onClose(); };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", key); };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-label={title} noValidate onSubmit={(e) => { e.preventDefault(); onSubmit?.(e); }} className="animate-rise flex h-full w-full max-w-2xl flex-col bg-white shadow-sheet">
        <header className="shrink-0 space-y-4 border-b border-slate-200 px-5 py-4 sm:px-7">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">{icon}</span>
            <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold text-slate-900">{title}</h2><p className="text-sm text-slate-500">{description}</p></div>
            <button type="button" aria-label="Close" onClick={onClose} className="pressable rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>
          {stepper}
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">{children}</div>
        <footer className="shrink-0 border-t border-slate-200 px-5 py-4 sm:px-7">{footer}</footer>
      </form>
    </div>,
    document.body,
  );
}

export function RecipientPanel(props: Props) {
  // Mounted only while open, so every opening starts clean.
  return props.open ? <Panel {...props} /> : null;
}

function Panel({ person, accounts, defaultCompanyId, onClose, onSaved }: Props) {
  const editing = !!person;
  const userId = useAppSelector((s) => s.auth.session?.profile.id);
  const key = draftKey(userId);
  const startCompany = defaultCompanyId ?? (accounts.length === 1 ? accounts[0].id : "");

  const [data, setData] = useState<WizardData>({ ...EMPTY, companyId: person?.companyId ?? startCompany });
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [groups, setGroups] = useState<PeopleGroup[]>([]);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [busy, setBusy] = useState<"" | "loading" | "checking" | "saving">(editing ? "loading" : "");
  const [result, setResult] = useState<SaveResult | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [resume, setResume] = useState<SavedDraft | null>(() => { const d = editing ? null : loadDraft(key); return d && hasContent(d.data) ? d : null; });
  const [leaving, setLeaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const occasions = useRef<OccasionsHandle>(null);
  const original = useRef<WizardData>(EMPTY); // what the person looked like when editing started

  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  useEffect(() => {
    if (!person) return;
    let stale = false;
    loadForEdit(person)
      .then((loaded) => { if (!stale) { original.current = loaded; setData(loaded); setBusy(""); } })
      .catch((e) => { if (!stale) setLoadFailed(errorMessage(e)); }); // saving a half-loaded form could erase what is there
    return () => { stale = true; };
  }, [person]);

  useEffect(() => {
    if (!data.companyId) return setGroups([]);
    let stale = false;
    apiClient.get<PeopleGroup[]>("/people-groups", { params: { companyId: data.companyId } }).then((r) => { if (!stale) setGroups(r.data); }).catch(() => undefined);
    return () => { stale = true; };
  }, [data.companyId]);

  // An unfinished new person is kept as a draft on this device until it is saved.
  useEffect(() => {
    if (editing || result || resume || !hasContent(data)) return;
    const timer = setTimeout(() => { storeDraft(key, data, step); setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })); }, 600);
    return () => clearTimeout(timer);
  }, [data, step, editing, result, resume, key]);

  const change = useCallback((p: Partial<WizardData>) => { setData((c) => ({ ...c, ...p })); setErrors({}); }, []);
  const changeDetails = (p: Partial<Details>) => {
    const identity = "name" in p || "mobile" in p || "email" in p; // changing who this is cancels "a different person"
    if (identity) setDuplicates([]);
    setData((c) => ({ ...c, details: { ...c.details, ...p }, allowDuplicate: identity ? false : c.allowDuplicate }));
    setErrors({});
  };
  const go = (target: number) => { setStep(target); setReached((r) => Math.max(r, target)); setErrors({}); };

  async function detailsReady(): Promise<boolean> {
    const found = validateDetails(data, !editing);
    if (Object.keys(found).length) { go(0); setErrors(found); return false; }
    if (editing || data.allowDuplicate) return true;
    setBusy("checking");
    try {
      const matches = await findDuplicates(data);
      setDuplicates(matches);
      if (matches.length) { go(0); return false; }
    } catch { /* the server checks again when saving */ } finally { setBusy(""); }
    return true;
  }

  function addressesReady(): boolean {
    const found = validateAddresses(data);
    if (Object.keys(found).length) { go(2); setErrors(found); return false; }
    return true;
  }

  async function save() {
    setBusy("saving");
    try {
      if (person) {
        const outcome = await saveEdit(person, data, original.current, photo, groups);
        if (outcome.warnings.length) toast.error(`Saved, but these could not be updated: ${[...new Set(outcome.warnings.map((w) => w.section))].join(", ")}. ${outcome.warnings[0].message}`, { duration: 10000 });
        else toast.success(`${outcome.name} updated.`);
        onSaved(); onClose();
      } else {
        const outcome = await saveNew(data, photo);
        clearDraft(key); setResult(outcome); onSaved();
      }
    } catch (e) {
      const current = errorData<{ reason?: string; current?: Person }>(e);
      const fields = fieldErrors(e);
      if (e instanceof DuplicateFound) { setDuplicates(e.matches); go(0); toast.error("This person may already be in your recipients."); }
      else if (statusOf(e) === 409 && current?.reason === "VERSION_CONFLICT") { toast.error("Someone else saved this person while you were editing. Close and open it again to see their changes."); onSaved(); }
      else if (Object.keys(fields).length) { go(0); setErrors({ ...fields, mobile: fields.mobileNumber ?? "" }); toast.error(errorMessage(e)); }
      else toast.error(errorMessage(e));
    } finally { setBusy(""); }
  }

  async function submit() {
    if (busy || loadFailed) return;
    if (step === 0) { if (await detailsReady()) go(1); return; }
    if (step === 1) { if (occasions.current?.trySave() ?? true) go(2); return; }
    if (step === 2) { if (addressesReady()) go(LAST); return; }
    if (addressesReady() && (await detailsReady())) await save();
  }

  const close = useCallback(() => {
    if (!editing && !result && hasContent(data)) setLeaving(true);
    else onClose();
  }, [editing, result, data, onClose]);
  const startAgain = () => { clearDraft(key); setStep(0); setReached(0); setData({ ...EMPTY, companyId: startCompany }); setPhoto(null); setDuplicates([]); setErrors({}); setResult(null); setSavedAt(null); };

  if (result) {
    return (
      <SidePanel title="Recipient added" description="The recipient is saved and shared with Gifting OS." icon={<CheckCircle2 className="h-5 w-5" />} onClose={onClose}
        footer={<div className="flex flex-wrap gap-3"><Button type="button" variant="secondary" className="flex-1" onClick={startAgain}><UserPlus className="h-4 w-4" />Add another</Button><Button type="button" className="flex-1" onClick={onClose}>Close</Button></div>}>
        <p className="text-sm font-semibold">{result.name}</p>
        {result.warnings.length > 0 && (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Some details could not be saved</p>
            <ul className="mt-1 list-disc pl-5">{result.warnings.map((w, i) => <li key={i}>{w.section}: {w.message}</li>)}</ul>
          </div>
        )}
      </SidePanel>
    );
  }

  const labels = ["Recipient Details", "Occasions", editing ? "Preferences & Delivery" : "Delivery Address", "Review & Save"];
  const hints = [
    "The basics. Only the name and mobile number are required.", "Optional. Birthdays, anniversaries or any date worth gifting for.",
    editing ? "Optional. Gifting preferences and where gifts are delivered." : "Optional. Where gifts are delivered. Preferences can be added later by editing the recipient.",
    "Check everything, then save. You can edit any section first.",
  ];
  const locked = busy !== "" || !!loadFailed;
  const existingPhoto = photoUrl ?? person?.photoUrl ?? null;

  return (
    <SidePanel title={editing ? "Edit Recipient" : "Add Recipient"} description={editing ? `Updating ${person.name}'s profile.` : "Create a new recipient profile."}
      icon={editing ? <UserRoundPen className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />} onClose={close} onSubmit={() => void submit()}
      stepper={<Stepper steps={labels} current={step} reached={editing ? LAST : reached} onGo={(s) => { if (!locked) go(s); }} />}
      footer={leaving ? (
        <div role="alertdialog" aria-label="Close without saving?" className="space-y-3">
          <p className="text-sm text-slate-700"><b>Close without saving?</b> Your entries can be kept as a draft on this device.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" className="mr-auto" onClick={() => setLeaving(false)}>Keep editing</Button>
            <Button type="button" variant="secondary" className="text-red-600" onClick={() => { clearDraft(key); onClose(); }}>Discard draft</Button>
            <Button type="button" onClick={() => { storeDraft(key, data, step); onClose(); }}>Keep draft &amp; close</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {savedAt && <p className="text-xs text-slate-500" aria-live="polite">Draft saved at {savedAt}</p>}
          <div className="flex items-center justify-between gap-3">
            {step === 0
              ? <Button type="button" variant="secondary" disabled={busy === "saving"} onClick={close}>Cancel</Button>
              : <Button type="button" variant="secondary" disabled={locked} onClick={() => go(step - 1)}><ArrowLeft className="h-4 w-4" />Back</Button>}
            <div className="flex gap-3">
              {step > 0 && step < LAST && <Button type="button" variant="ghost" disabled={locked} onClick={() => go(step + 1)}>Skip</Button>}
              <Button type="submit" disabled={locked} loading={busy === "saving"}>
                {busy === "checking" ? "Checking…" : busy === "loading" ? "Loading…" : step === LAST ? (editing ? "Save Changes" : "Save Recipient") : <>Next<ArrowRight className="h-4 w-4" /></>}
              </Button>
            </div>
          </div>
        </div>
      )}>
      {loadFailed && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">This person&apos;s details could not be loaded, so nothing can be saved. Close and try again. {loadFailed}</p>}
      {resume && step === 0 && (
        <div role="region" aria-label="Saved draft" className="rounded-xl border border-brand/25 bg-brand-soft px-4 py-3">
          <p className="text-sm"><b>You have a saved draft</b> for {resume.data.details.name.trim() || "a new recipient"} from {new Date(resume.savedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => { const at = Math.min(resume.step ?? 0, LAST); setData(resume.data); setStep(at); setReached(at); setResume(null); }}>Continue draft</Button>
            <Button type="button" variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => { clearDraft(key); setResume(null); }}>Start over</Button>
          </div>
        </div>
      )}
      <div><h3 className="text-base font-semibold text-slate-900">{labels[step]}</h3><p className="text-sm text-slate-500">{hints[step]}</p></div>
      {step === 0 && (
        <DetailsStep data={data} errors={errors} photoUrl={existingPhoto} accounts={accounts} askClient={!editing && accounts.length > 1} groups={groups} duplicates={duplicates}
          onChange={change} onDetails={changeDetails} onPhoto={setPhoto} onConfirmDifferent={() => { setData((c) => ({ ...c, allowDuplicate: true })); setDuplicates([]); go(1); }} />
      )}
      {step === 1 && <OccasionsStep ref={occasions} items={data.occasions} editing={editing} onChange={(list) => change({ occasions: list })} />}
      {step === 2 && (
        <>
          {editing && <div className="mb-7"><PreferencesFields prefs={data.preferences} onChange={(p) => change({ preferences: { ...data.preferences, ...p } })} /></div>}
          <AddressSection data={data} errors={errors} onChange={change} />
        </>
      )}
      {step === LAST && <ReviewStep data={data} groups={groups} photoUrl={existingPhoto} showPreferences={editing} onEdit={go} />}
    </SidePanel>
  );
}
