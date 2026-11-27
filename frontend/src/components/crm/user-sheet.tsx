"use client";
import { Check, Copy, Eye, EyeOff, KeyRound, MessageCircle, RefreshCw, UserCog, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ImagePicker } from "@/components/ui/image-picker";
import { InputField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { uploadPhoto } from "@/features/media/upload";
import { fieldErrors } from "@/lib/api-errors";
import { openWhatsApp } from "@/lib/format";
import { EMAIL_MSG, isEmail, isPhone10, PHONE_MSG } from "@/lib/validation";
import { apiClient, errorMessage } from "@/services/api-client";
import { ROLE_LABEL, type Role } from "@/types/api";

export type UserRow = { id: string; avatarUrl?: string | null; email?: string | null; phone?: string | null; fullName?: string | null; role: Role; managerId?: string | null; isActive: boolean };

type Props = {
  open: boolean;
  /** The person being edited; empty to add someone new. */
  user?: UserRow | null;
  /** Editing: open straight on "set a new password". */
  startWithPassword?: boolean;
  roles: Role[];
  managers: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
};

const PASSWORD_MSG = "8 or more characters, with upper and lower case letters and a number";
const strong = (p: string) => p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);

/** A strong, easy-to-read password: no 0/O, 1/l/I look-alikes. Always has upper, lower, digit and a symbol. */
export function generatePassword(length = 12): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "@#$%&*"];
  const all = sets.join("");
  const rand = (n: number) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const chars = sets.map((s) => s[rand(s.length)]);
  while (chars.length < length) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = rand(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

const tenDigits = (p?: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);

/**
 * Add or edit a person. A new person gets a password straight away (generated, or typed), and the sheet ends on a
 * "share these sign-in details" step, because the admin is the one who hands them over.
 */
export function UserSheet({ open, user, startWithPassword, roles, managers, onClose, onDone }: Props) {
  const editing = !!user;
  const [v, setV] = useState({ fullName: "", email: "", phone: "", managerId: "" });
  const [role, setRole] = useState<Role>(roles[0]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [setPw, setSetPw] = useState(false); // editing: also set a new password
  const [show, setShow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [shared, setShared] = useState<{ name: string; email: string; password: string; phone?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setV({ fullName: user?.fullName ?? "", email: user?.email ?? "", phone: tenDigits(user?.phone), managerId: user?.managerId ?? "" });
    setRole(user?.role ?? roles[0]);
    setPhoto(null);
    setPassword(user && !startWithPassword ? "" : generatePassword());
    setSetPw(!!user && !!startWithPassword);
    setShow(true);
    setErrors({});
    setShared(null);
  }, [open, user, roles, startWithPassword]);

  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: "" }));
  };
  const needsPassword = !editing || setPw;

  function validate() {
    const e: Record<string, string> = {};
    if (!v.fullName.trim()) e.fullName = "Full name is required";
    if (!v.email.trim()) e.email = "Email is required. It is how they sign in";
    else if (!isEmail(v.email)) e.email = EMAIL_MSG;
    if (v.phone.trim() && !isPhone10(v.phone)) e.phone = PHONE_MSG;
    if (needsPassword && !strong(password)) e.password = password ? PASSWORD_MSG : "Enter or generate a password";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setBusy(true);
    try {
      let id = user?.id;
      if (!editing) {
        const res = await apiClient.post<{ id: string }>("/users", {
          fullName: v.fullName.trim(), email: v.email.trim(), phone: v.phone.trim() || null, password, role, managerId: v.managerId || null,
        });
        id = res.data.id;
      } else {
        const body: Record<string, unknown> = {};
        if (v.fullName.trim() !== (user.fullName ?? "")) body.fullName = v.fullName.trim();
        if (v.email.trim().toLowerCase() !== (user.email ?? "").toLowerCase()) body.email = v.email.trim();
        if (v.phone.trim() && v.phone.trim() !== tenDigits(user.phone)) body.phone = v.phone.trim();
        if (role !== user.role) body.role = role;
        if ((v.managerId || null) !== (user.managerId ?? null)) {
          if (v.managerId) body.managerId = v.managerId;
          else body.clearManager = true;
        }
        if (setPw) body.password = password;
        if (Object.keys(body).length) await apiClient.patch(`/users/${user.id}`, body);
      }
      if (photo && id) {
        try {
          await uploadPhoto(`/users/${id}/avatar`, photo);
        } catch {
          toast.warning("Saved, but the photo could not be uploaded. Try again from Edit.");
        }
      }
      onDone();
      if (needsPassword) {
        setShared({ name: v.fullName.trim(), email: v.email.trim(), password, phone: v.phone.trim() || undefined });
        toast.success(editing ? "Password updated" : "User added");
      } else {
        toast.success("Saved");
        onClose();
      }
    } catch (e) {
      const fe = fieldErrors(e);
      Object.keys(fe).length ? setErrors(fe) : toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const signInUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";
  const message = shared ? `Hi ${shared.name.split(" ")[0]}, your TOFAA CRM sign-in:\n${signInUrl}\nEmail: ${shared.email}\nPassword: ${shared.password}\nYou can change the password from your profile after signing in.` : "";

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Could not copy. Select the text and copy it instead.");
    }
  }

  return (
    <Sheet
      open={open}
      title={shared ? "Share sign-in details" : editing ? "Edit user" : "Add user"}
      subtitle={shared ? shared.name : editing ? user?.fullName ?? user?.email ?? undefined : "They sign in with their email and this password"}
      icon={shared ? KeyRound : editing ? UserCog : UserPlus}
      tone={shared ? "emerald" : "sky"}
      onClose={onClose}
    >
      {shared ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Send these to {shared.name.split(" ")[0]}. The password is shown only now, so share it before closing.</p>
          <dl className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-slate-50/60 text-sm">
            {[["Sign-in page", signInUrl], ["Email", shared.email], ["Password", shared.password]].map(([k, val]) => (
              <div key={k} className="flex items-center gap-3 px-4 py-3">
                <dt className="w-24 shrink-0 text-slate-500">{k}</dt>
                <dd className="min-w-0 flex-1 truncate font-medium text-slate-900 [font-variant-ligatures:none]">{val}</dd>
                <button type="button" onClick={() => void copy(val, k)} aria-label={`Copy ${k}`} className="pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-900"><Copy className="h-4 w-4" /></button>
              </div>
            ))}
          </dl>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="secondary" onClick={() => void copy(message, "Sign-in details")}><Copy className="h-4 w-4" /> Copy all</Button>
            <Button variant="secondary" disabled={!shared.phone} onClick={() => openWhatsApp(shared.phone, message)}><MessageCircle className="h-4 w-4" /> Send on WhatsApp</Button>
          </div>
          <Button className="w-full" onClick={onClose}><Check className="h-4 w-4" /> Done</Button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate className="space-y-4">
          <ImagePicker label="Photo" name={v.fullName} file={photo} onChange={setPhoto} existingUrl={user?.avatarUrl ?? undefined} />
          <InputField label="Full name" required autoFocus={!editing} placeholder="Enter full name" value={v.fullName} onChange={set("fullName")} error={errors.fullName} />
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField label="Email" required type="email" placeholder="Enter email" value={v.email} onChange={set("email")} error={errors.email} />
            <InputField label="Mobile" type="tel" inputMode="tel" placeholder="Enter mobile number" value={v.phone} onChange={set("phone")} error={errors.phone} />
          </div>
          {roles.length > 1 && (
            <SelectField label="Role" required value={role} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} onChange={(e) => setRole(e.target.value as Role)} />
          )}
          {managers.length > 0 && role === "kam" && (
            <SelectField label="Reports to" placeholder="No manager" value={v.managerId} options={managers.filter((m) => m.id !== user?.id).map((m) => ({ value: m.id, label: m.name }))} onChange={set("managerId")} />
          )}

          {editing && !setPw ? (
            <button type="button" onClick={() => { setSetPw(true); setPassword(generatePassword()); }} className="pressable flex w-full items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-3 text-left hover:bg-slate-50">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><KeyRound className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block text-sm font-medium text-slate-800">Set a new password</span><span className="block text-xs text-slate-500">For someone who is locked out</span></span>
            </button>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{editing ? "New password" : "Password"}<span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span></span>
                {editing && <button type="button" onClick={() => { setSetPw(false); setErrors((x) => ({ ...x, password: "" })); }} className="text-xs font-medium text-slate-500 hover:text-slate-800">Keep current password</button>}
              </div>
              <div className={`flex h-11 items-center gap-1 rounded-xl border bg-white pl-3.5 pr-1 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15 ${errors.password ? "border-red-400 ring-4 ring-red-100" : "border-slate-300/80"}`}>
                <input
                  aria-label={editing ? "New password" : "Password"}
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  placeholder="Enter or generate a password"
                  onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: "" })); }}
                  className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm tracking-wide text-slate-900 outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-400 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="pressable flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                <button type="button" onClick={() => void copy(password, "Password")} disabled={!password} aria-label="Copy password" className="pressable flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40"><Copy className="h-4 w-4" /></button>
                <button type="button" onClick={() => { setPassword(generatePassword()); setShow(true); setErrors((x) => ({ ...x, password: "" })); }} className="pressable flex h-8 items-center gap-1.5 rounded-lg bg-brand-soft px-2.5 text-xs font-semibold text-brand hover:bg-brand-100">
                  <RefreshCw className="h-3.5 w-3.5" /> Generate
                </button>
              </div>
              {errors.password ? <p role="alert" className="text-xs font-medium text-red-600">{errors.password}</p> : <p className="text-xs text-slate-500">You will be able to copy or send it on the next step.</p>}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" loading={busy} className="flex-1">{editing ? "Save changes" : "Add user"}</Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
