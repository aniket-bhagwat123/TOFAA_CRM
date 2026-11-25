"use client";
import { Download, ExternalLink, Mail, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
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
  // Without the WhatsApp Business API (the current setup) the message goes by click-to-chat, with the PDF link in the text.
  const wa = useApi<{ apiEnabled: boolean }>(quotation ? "/whatsapp/status" : null);

  async function send() {
    if (!quotation) return;
    if (!follow) return setError("Pick the next follow-up date");
    setBusy(true);
    try {
      const res = await apiClient.post<{ mode: string; url?: string; button?: boolean; fallback?: string }>(`/quotations/${quotation.id}/send`, { channel, nextFollowUp: follow });
      if (res.data.mode === "click_to_chat" && res.data.url) {
        window.open(res.data.url, "_blank", "noopener");
        toast.success(
          res.data.fallback === "template_required"
            ? "The client has not messaged in the last 24 hours and no approved WhatsApp template is set up, so WhatsApp opened with a PDF link instead. The quotation is marked as sent."
            : "WhatsApp opened with the message and PDF link. The quotation is marked as sent.",
          { duration: 8000 },
        );
      } else if (channel === "email") toast.success("Quotation emailed with the PDF attached");
      else toast.success(res.data.button ? "Quotation sent on WhatsApp with the View quotation button" : "Quotation sent on WhatsApp");
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
            {option("whatsapp", "WhatsApp", wa.data?.apiEnabled ? "Message with a View quotation button" : "Opens WhatsApp with the message and PDF link", MessageCircle)}
            {option("email", "Email", "PDF attached", Mail)}
          </div>
          {channel === "whatsapp" && target && <WhatsAppPreview target={target} quotation={quotation} button={!!wa.data?.apiEnabled} />}
          <DateChips label="Next follow-up" required value={follow} onChange={(d) => { setFollow(d); setError(undefined); }} error={error} />
          <Button onClick={send} loading={busy} className="w-full"><Send className="h-4 w-4" /> Send quotation</Button>
        </div>
      )}
    </Sheet>
  );
}

/**
 * What the client receives on WhatsApp. With the Business API: the message and a "View quotation" button. Without it
 * (click-to-chat, the current setup): the message as it is sent today, with the PDF link in the text.
 */
function WhatsAppPreview({ target, quotation, button }: { target: LeadTarget; quotation: Quotation; button: boolean }) {
  const [company, contact] = target.name.split(" · ");
  const name = (target.contactName ?? contact ?? "there").split(" ")[0];
  if (!button) {
    return (
      <div className="rounded-2xl bg-[#efeae2] p-3" aria-label="WhatsApp preview">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">What the client receives</p>
        <div className="max-w-[20rem] rounded-xl rounded-tl-sm bg-white px-3 py-2.5 text-[13px] leading-snug text-slate-800 shadow-sm">
          Hello {target.contactName ?? contact ?? "there"}, here is our quotation {quotation.number} for {company}. Total: {inr(quotation.total)}.
          <br />View or download: <span className="break-all text-sky-600 underline">link to the PDF</span>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-[#efeae2] p-3" aria-label="WhatsApp preview">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">What the client receives</p>
      <div className="max-w-[20rem] overflow-hidden rounded-xl rounded-tl-sm bg-white shadow-sm">
        <div className="whitespace-pre-line px-3 pb-1.5 pt-2.5 text-[13px] leading-snug text-slate-800">
          {`Hello ${name},

Thank you for your interest in Tofaa India. Your quotation ${quotation.number} for ${company} is ready.
Total: ${inr(quotation.total)}

Tap the button below to view or download it.`}
        </div>
        <div className="flex items-center justify-center gap-1.5 border-t border-slate-100 py-2 text-[13px] font-medium text-sky-600">
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />View quotation
        </div>
      </div>
    </div>
  );
}
