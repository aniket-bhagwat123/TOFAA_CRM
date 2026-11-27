"use client";
/** The client's Gifting OS details and logins, changed from the CRM. Everything is saved in Gifting OS. */
import { Building2, ImagePlus, Trash2, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { fieldErrors } from "@/lib/api-errors";
import { apiClient, errorMessage } from "@/services/api-client";
import type { GiftingClient, GiftingLogin } from "@/types/gifting";

export const LOGIN_ROLES = [{ value: "OWNER", label: "Owner (Director)" }, { value: "EA", label: "Executive assistant" }, { value: "HR", label: "HR" }];
const MAX_BYTES = 2 * 1024 * 1024;

type Saved = (data: GiftingClient) => void;

/** Logo, legal name, GSTIN, email domain, and switching the client on or off. Mount only while open. */
export function ClientDetailsSheet({ companyId, client, onClose, onSaved }: { companyId: string; client: GiftingClient; onClose: () => void; onSaved: Saved }) {
  const [form, setForm] = useState({ legalName: client.legalName ?? "", gstin: client.gstin ?? "", emailDomain: client.emailDomain ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const inactive = client.status === "DEACTIVATED";
  const base = `/gifting-clients/${companyId}`;
  const set = (patch: Partial<typeof form>) => { setForm((c) => ({ ...c, ...patch })); setErrors({}); };

  async function run(what: string, done: string, call: () => Promise<{ data: GiftingClient }>, close = false) {
    setBusy(what);
    try {
      const res = await call();
      onSaved(res.data);
      toast.success(done);
      if (close) onClose();
    } catch (e) {
      const found = fieldErrors(e);
      if (Object.keys(found).length) setErrors(found);
      toast.error(errorMessage(e), { duration: 8000 });
    } finally {
      setBusy("");
    }
  }

  function upload(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return toast.error("Use a PNG, JPEG or WebP picture.");
    if (file.size > MAX_BYTES) return toast.error("The logo must be 2 MB or smaller.");
    const body = new FormData();
    body.append("file", file);
    void run("logo", "Logo saved", () => apiClient.put<GiftingClient>(`${base}/logo`, body));
  }

  function save() {
    const gstin = form.gstin.trim();
    if (gstin && !/^[A-Za-z0-9]{15}$/.test(gstin)) return setErrors({ gstin: "A GSTIN has 15 letters and digits." });
    void run("details", "Client details saved", () => apiClient.patch<GiftingClient>(base, form), true);
  }

  return (
    <Sheet open title="Client details" subtitle="Saved in Gifting OS" icon={Building2} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar src={client.logoUrl} name={client.name} size="xl" square className={client.logoUrl ? "bg-white object-contain ring-1 ring-slate-200" : undefined} />
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-2">
              <label className="pressable inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-300/80 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <ImagePlus className="h-4 w-4" />{busy === "logo" ? "Saving…" : client.logoUrl ? "Change logo" : "Upload logo"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={!!busy || inactive} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {client.logoUrl && <Button variant="ghost" disabled={!!busy || inactive} onClick={() => void run("logo", "Logo removed", () => apiClient.delete<GiftingClient>(`${base}/logo`))}><Trash2 className="h-4 w-4" />Remove</Button>}
            </div>
            <p className="text-xs text-slate-500">PNG, JPEG or WebP, up to 2 MB.</p>
          </div>
        </div>
        <InputField label="Legal name (optional)" maxLength={200} value={form.legalName} error={errors.legalName} onChange={(e) => set({ legalName: e.target.value })} />
        <InputField label="GSTIN (optional)" maxLength={15} value={form.gstin} error={errors.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />
        <InputField label="Email domain (optional)" maxLength={253} placeholder="e.g. company.com" value={form.emailDomain} error={errors.emailDomain} onChange={(e) => set({ emailDomain: e.target.value })} />
        {inactive && <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">This client is switched off in Gifting OS. Switch it on to change its details.</p>}
        <Button className="w-full" loading={busy === "details"} disabled={inactive} onClick={save}>Save details</Button>

        <div className="border-t border-slate-200 pt-4">
          {confirmOff ? (
            <div className="space-y-3 rounded-xl bg-red-50 p-4">
              <p className="text-sm text-red-800">Switch {client.name} off in Gifting OS? Its people there can no longer sign in or make changes. Nothing is deleted.</p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmOff(false)}>Cancel</Button>
                <Button variant="danger" loading={busy === "active"} onClick={() => void run("active", "Switched off in Gifting OS", () => apiClient.post<GiftingClient>(`${base}/active`, { active: false }), true)}>Switch off</Button>
              </div>
            </div>
          ) : inactive ? (
            <Button variant="secondary" className="w-full" loading={busy === "active"} onClick={() => void run("active", "Switched on in Gifting OS", () => apiClient.post<GiftingClient>(`${base}/active`, { active: true }), true)}>Switch on in Gifting OS</Button>
          ) : (
            <button type="button" onClick={() => setConfirmOff(true)} className="text-sm font-medium text-red-600 hover:underline">Switch off in Gifting OS</button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** One client login: name, role, and whether it can sign in. Mount only while open. */
export function ClientLoginSheet({ companyId, login, onClose, onSaved }: { companyId: string; login: GiftingLogin; onClose: () => void; onSaved: Saved }) {
  const [fullName, setFullName] = useState(login.fullName ?? "");
  const [clientRole, setClientRole] = useState(login.clientRole ?? "");
  const [busy, setBusy] = useState("");
  const off = login.status !== "ACTIVE" && login.status !== "INVITED";

  async function run(what: string, done: string, body: Record<string, unknown>) {
    setBusy(what);
    try {
      const res = await apiClient.patch<GiftingClient>(`/gifting-clients/${companyId}/users/${login.userId}`, body);
      onSaved(res.data);
      toast.success(done);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    } finally {
      setBusy("");
    }
  }

  return (
    <Sheet open title="Client login" subtitle={login.email} icon={UserCog} onClose={onClose}>
      <div className="space-y-4">
        <InputField label="Full name" maxLength={150} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <SelectField label="Role" value={clientRole} placeholder="Choose a role" options={LOGIN_ROLES} onChange={(e) => setClientRole(e.target.value)} />
        <Button className="w-full" loading={busy === "save"} disabled={!fullName.trim()} onClick={() => void run("save", "Login saved", { fullName: fullName.trim(), clientRole: clientRole || undefined })}>Save</Button>
        <Button variant={off ? "secondary" : "danger"} className="w-full" loading={busy === "active"} onClick={() => void run("active", off ? "Sign-in switched on" : "Sign-in switched off", { isActive: off })}>
          {off ? "Allow sign-in" : "Stop sign-in"}
        </Button>
      </div>
    </Sheet>
  );
}
