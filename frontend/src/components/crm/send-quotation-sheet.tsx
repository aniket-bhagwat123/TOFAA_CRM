"use client";
import { Download, Mail, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { openPdf } from "@/features/media/download";
import { fieldErrors } from "@/lib/api-errors";
import { nextBusinessDayIso } from "@/lib/format";
import { inr } from "@/lib/money";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { Quotation } from "@/types/crm";
import { DateChips } from "./date-chips";
import type { LeadTarget } from "./types";

type Props = { target: LeadTarget | null; quotation: Quotation | null; onClose: () => void; onDone: () => void };

/** Sending is the action that moves the lead to Quotation Sent: pick the channel and the next follow-up, one tap. */
export function SendQuotationSheet({ target, quotation, onClose, onDone }: Props) {
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [follow, setFollow] = useState(nextBusinessDayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function send() {
    if (!quotation) return;
    if (!follow) return setError("Pick the next follow-up date");
    setBusy(true);
    try {
      const res = await apiClient.post<{ mode: string; url?: string }>(`/quotations/${quotation.id}/send`, { channel, nextFollowUp: follow });
      if (res.data.mode === "click_to_chat" && res.data.url) {
        window.open(res.data.url, "_blank", "noopener");
        toast.success("WhatsApp opened with the message and PDF link. The quotation is marked as sent.");
      } else toast.success(channel === "email" ? "Quotation emailed" : "Quotation sent on WhatsApp");
      onClose();
      onDone();
    } catch (err) {
      const fe = fieldErrors(err);
      setError(fe.nextFollowUp ?? fe.channel);
      if (!fe.nextFollowUp && !fe.channel) toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const option = (key: "whatsapp" | "email", label: string, hint: string, Icon: typeof Mail) => (
    <button
      type="button"
      onClick={() => setChannel(key)}
      aria-pressed={channel === key}
      className={cn("pressable flex flex-1 items-start gap-3 rounded-2xl border p-3.5 text-left", channel === key ? "border-brand bg-brand-soft" : "border-slate-200 hover:bg-slate-50")}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", channel === key ? "bg-brand text-white" : "bg-slate-100 text-slate-500")}><Icon className="h-4 w-4" /></span>
      <span><span className="block text-sm font-semibold text-slate-900">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>
    </button>
  );

  return (
    <Sheet open={!!quotation} title={`Send ${quotation?.number ?? "quotation"}`} subtitle={target?.name} icon={Send} tone="violet" onClose={onClose}>
      {quotation && (
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
            <div>
              <div className="text-xs text-slate-400">Version {quotation.version}</div>
              <div className="text-lg font-semibold text-slate-900">{inr(quotation.total)}</div>
            </div>
            <Button type="button" variant="secondary" className="min-h-9 px-3 py-1.5" onClick={() => void openPdf(`/quotations/${quotation.id}/pdf`)}><Download className="h-4 w-4" /> Preview PDF</Button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {option("whatsapp", "WhatsApp", "Message with a link to the PDF", MessageCircle)}
            {option("email", "Email", "PDF attached", Mail)}
          </div>
          <DateChips label="Next follow-up" required value={follow} onChange={(d) => { setFollow(d); setError(undefined); }} error={error} />
          <Button onClick={send} loading={busy} className="w-full"><Send className="h-4 w-4" /> Send quotation</Button>
        </div>
      )}
    </Sheet>
  );
}
