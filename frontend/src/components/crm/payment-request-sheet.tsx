"use client";
import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { Sheet } from "@/components/ui/sheet";
import { fieldErrors } from "@/lib/api-errors";
import { inr } from "@/lib/money";
import { apiClient, errorMessage } from "@/services/api-client";
import type { LeadTarget } from "./types";

type Props = { target: LeadTarget | null; suggestedAmount?: number | null; onClose: () => void; onDone: () => void };

/** The KAM only asks. Finance records the payment in the ERP, and the deal closes by itself when it arrives. */
export function PaymentRequestSheet({ target, suggestedAmount, onClose, onDone }: Props) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => { if (target) setAmount(suggestedAmount ? String(suggestedAmount) : ""); else { setAmount(""); setErrors({}); } }, [target, suggestedAmount]);

  async function save() {
    if (!target) return;
    const e: Record<string, string> = {};
    if (!(Number(amount) > 0)) e.amount = amount ? "Amount must be greater than 0" : "Enter the amount";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await apiClient.post(`/leads/${target.leadId}/payment-request`, { amount: Number(amount) });
      toast.success("Payment requested. Finance has been told.");
      onClose();
      onDone();
    } catch (err) {
      const fe = fieldErrors(err);
      Object.keys(fe).length ? setErrors(fe) : toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!target} title="Payment requested" subtitle={target?.name} icon={Wallet} tone="emerald" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">Enter the amount to be paid. Finance records the payment in the ERP, and this deal turns to Won as soon as it arrives. You cannot mark it received yourself.</p>
        <InputField label="Amount (₹)" type="number" required value={amount} onChange={(e) => { setAmount(e.target.value); setErrors((x) => ({ ...x, amount: "" })); }} error={errors.amount} />
        {suggestedAmount ? <p className="-mt-2 text-xs text-slate-400">Quoted total: {inr(suggestedAmount)}</p> : null}
        <Button onClick={save} loading={busy} className="w-full">Request payment</Button>
      </div>
    </Sheet>
  );
}
