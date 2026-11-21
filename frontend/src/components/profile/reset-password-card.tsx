"use client";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { isStrongPassword, passwordProblem } from "@/components/auth/password-rules";
import { changePassword } from "@/features/auth/auth.service";
import { errorMessage } from "@/services/api-client";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { PasswordField } from "../ui/password-field";

/** You are already signed in, so you choose the new password right here. No code to wait for. */
export function ResetPasswordCard() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  const strong = isStrongPassword(password);
  const matches = password !== "" && password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!strong || !matches) return;
    setBusy(true);
    try {
      await changePassword(password);
      toast.success("Password updated");
      setPassword(""); setConfirm(""); setTried(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not update the password."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><KeyRound className="h-5 w-5" /></span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Reset password</h2>
          <p className="text-sm text-slate-500">Choose a new password. You can always sign in with a one-time code instead.</p>
        </div>
      </div>

      <form onSubmit={submit} noValidate className="space-y-4">
        <PasswordField
          label="New password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={tried ? passwordProblem(password) : undefined}
        />
        <PasswordField
          label="Confirm new password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={(confirm || tried) && !matches ? (confirm ? "Passwords do not match" : "Confirm your new password") : undefined}
        />
        <Button type="submit" loading={busy} className="w-full sm:w-auto">Update password</Button>
      </form>
    </Card>
  );
}
