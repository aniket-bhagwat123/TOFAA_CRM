"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { OtpInput, OTP_LENGTH } from "@/components/auth/otp-input";
import { isStrongPassword, passwordProblem } from "@/components/auth/password-rules";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { PasswordField } from "@/components/ui/password-field";
import { requestOtp, resetPassword } from "@/features/auth/auth.service";
import { useCountdown } from "@/hooks/use-countdown";
import { forgetIdentifier, recallIdentifier } from "@/lib/identifier";
import { identifierProblem } from "@/lib/validation";
import { errorMessage } from "@/services/api-client";


/** Step 2 of 2: the code proves it is you, then you choose a new password. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false); // show the messages only after a first attempt
  const resend = useCountdown(30);

  useEffect(() => { setIdentifier(recallIdentifier()); resend.start(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const strong = isStrongPassword(password);
  const matches = password !== "" && password === confirm;
  const ready = !identifierProblem(identifier) && code.length === OTP_LENGTH && strong && matches;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ready) return;
    setBusy(true);
    try {
      await resetPassword(identifier.trim(), code, password);
      forgetIdentifier();
      toast.success("Password updated. Sign in with your new password.");
      router.replace("/login");
    } catch (err) {
      toast.error(errorMessage(err, "Could not reset the password."));
      setBusy(false);
    }
  }

  async function resendCode() {
    try {
      await requestOtp(identifier.trim());
      resend.start();
      toast.success("New code sent.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <AuthShell
      art="reset"
      title="Choose a new password"
      subtitle={identifier ? <>Enter the code we sent to <b className="font-semibold text-slate-700">{identifier}</b>, then pick a new password.</> : "Enter the code we sent you, then pick a new password."}
      footer={<Link href="/login" className="font-medium text-brand hover:underline">Back to sign in</Link>}
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {!identifier && <InputField label="Mobile number or email" required autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} error={tried ? identifierProblem(identifier) : undefined} />}
        <div className="space-y-2">
          <span className="text-sm font-medium text-slate-700">One-time code<span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span></span>
          <OtpInput value={code} onChange={setCode} disabled={busy} error={tried && code.length < OTP_LENGTH} />
          {tried && code.length < OTP_LENGTH && <p role="alert" className="text-xs font-medium text-red-600">Enter the {OTP_LENGTH}-digit code we sent you</p>}
          <p className="text-xs text-slate-500">
            {resend.left > 0 ? `Resend in ${resend.left}s` : <button type="button" className="font-medium text-brand hover:underline" onClick={resendCode}>Resend code</button>}
          </p>
        </div>
        <PasswordField label="New password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={tried ? passwordProblem(password) : undefined} />
        <PasswordField
          label="Confirm new password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={(confirm || tried) && !matches ? (confirm ? "Passwords do not match" : "Confirm your new password") : undefined}
        />
        <Button type="submit" loading={busy} className="w-full py-3">Update password</Button>
      </form>
    </AuthShell>
  );
}
