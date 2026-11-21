"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { requestOtp } from "@/features/auth/auth.service";
import { rememberIdentifier } from "@/lib/identifier";
import { identifierProblem } from "@/lib/validation";
import { errorMessage } from "@/services/api-client";

/** Step 1 of 2: we send the same one-time code used for sign-in. Works for email and mobile-only users. */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = identifierProblem(identifier);
    if (problem) return setErr(problem);
    setBusy(true);
    try {
      await requestOtp(identifier.trim());
      rememberIdentifier(identifier.trim());
      toast.success("If that account exists, a code is on its way.");
      router.push("/reset-password");
    } catch (err) {
      toast.error(errorMessage(err, "Could not send the code."));
      setBusy(false);
    }
  }

  return (
    <AuthShell
      art="forgot"
      title="Forgot your password?"
      subtitle="Enter your email or mobile number. We will send a code so you can choose a new password."
      footer={<Link href="/login" className="inline-flex items-center gap-1 font-medium text-brand hover:underline"><ArrowLeft className="h-4 w-4" /> Back to sign in</Link>}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <InputField label="Mobile number or email" required autoComplete="username" inputMode="email" autoFocus value={identifier} onChange={(e) => { setIdentifier(e.target.value); setErr(undefined); }} error={err} />
        <Button type="submit" loading={busy} className="w-full py-3">Send code</Button>
      </form>
    </AuthShell>
  );
}
