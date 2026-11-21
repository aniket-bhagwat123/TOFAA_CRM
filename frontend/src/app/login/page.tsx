"use client";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { Spinner } from "@/components/ui/spinner";
import { passwordLogin } from "@/features/auth/auth.service";
import { setSession } from "@/features/auth/auth.slice";
import { homeFor } from "@/lib/roles";
import { rememberedChoice, setRemember } from "@/lib/session";
import { cn } from "@/lib/utils";
import { EMAIL_MSG, isEmail } from "@/lib/validation";
import { errorMessage } from "@/services/api-client";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

/** Email and password. (Sign-in by one-time code is gone; the code is only used to reset a forgotten password.) */
export default function LoginPage() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { session, ready } = useAppSelector((s) => s.auth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [keep, setKeep] = useState(false);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ email?: string; pw?: string }>({});

  useEffect(() => setKeep(rememberedChoice()), []);
  useEffect(() => {
    if (ready && session) router.replace(homeFor(session.profile.role));
  }, [ready, session, router]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    const next: { email?: string; pw?: string } = {};
    const value = email.trim();
    if (!value) next.email = "Enter your email address";
    else if (!isEmail(value)) next.email = EMAIL_MSG;
    if (!password) next.pw = "Enter your password";
    setErr(next);
    if (next.email || next.pw) return;
    setBusy(true);
    try {
      const s = await passwordLogin(value, password);
      setRemember(keep); // where the session is kept: this browser, or only this tab
      dispatch(setSession(s));
      router.replace(homeFor(s.profile.role));
    } catch (error) {
      toast.error(errorMessage(error, "Could not sign in."));
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in with your company email and password.">
      <form onSubmit={signIn} noValidate className="space-y-4">
        <IconField
          icon={<Mail className="h-5 w-5" />}
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => { setEmail(e.target.value); setErr((x) => ({ ...x, email: undefined })); }}
          error={err.email}
        />
        <IconField
          icon={<Lock className="h-5 w-5" />}
          label="Password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setErr((x) => ({ ...x, pw: undefined })); }}
          error={err.pw}
          trailing={
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} className="pressable flex h-9 w-9 items-center justify-center rounded-lg text-[#0A2540] hover:bg-slate-100">
              {show ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </button>
          }
        />

        <div className="flex items-center justify-between gap-3 pt-0.5">
          <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm text-slate-700">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="h-[18px] w-[18px] cursor-pointer rounded border-slate-300 accent-brand" />
            Remember me
          </label>
          <Link href="/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand hover:underline">Forgot password?</Link>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="pressable mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand text-base font-semibold sm:h-14 sm:text-[17px] text-white shadow-[0_10px_24px_-10px_rgba(15,76,117,0.8)] hover:bg-brand-dark disabled:opacity-70"
        >
          {busy ? <Spinner className="h-4 w-4" /> : "Sign in"}
        </button>
      </form>

      <div className="mx-auto mt-7 flex max-w-xs items-center gap-4">
        <span className="h-px flex-1 bg-slate-200" />
        <button type="button" onClick={() => setHelp((v) => !v)} aria-expanded={help} className="text-[15px] text-[#0A2540] hover:text-brand">Need help?</button>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      {help && (
        <p className="animate-rise mt-3 rounded-xl bg-brand-50 px-4 py-3 text-center text-[13px] leading-relaxed text-slate-600">
          Forgot your password? Use <Link href="/forgot-password" className="font-medium text-brand hover:underline">Forgot password</Link> to set a new one.
          No account yet, or locked out? Ask your admin.
        </p>
      )}
    </AuthShell>
  );
}

type IconFieldProps = InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode; label: string; error?: string; trailing?: ReactNode };

/** A field with a leading icon and the label as its placeholder (the label is still there for screen readers). */
function IconField({ icon, label, error, trailing, id, ...rest }: IconFieldProps) {
  const fieldId = id ?? `f-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="space-y-1">
      <label htmlFor={fieldId} className="sr-only">{label}</label>
      <div className={cn(
        "flex h-12 items-center gap-3 rounded-2xl border bg-white pl-4 pr-2 sm:h-14 transition-shadow focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15",
        error ? "border-red-400 ring-4 ring-red-100" : "border-slate-300/80",
      )}>
        <span className="shrink-0 text-[#0A2540]">{icon}</span>
        <input
          id={fieldId}
          placeholder={label}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-base focus-visible:ring-0 focus-visible:ring-offset-0 text-slate-900 outline-none placeholder:text-slate-400 sm:text-[15px]"
          {...rest}
        />
        {trailing}
      </div>
      {error && <p id={`${fieldId}-error`} role="alert" className="px-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
