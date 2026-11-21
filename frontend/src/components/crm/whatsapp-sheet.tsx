"use client";
import { MessageCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { formatDate, formatTime } from "@/lib/format";
import { errorData } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { LeadTarget } from "./types";
import { VoiceTextarea } from "./voice-textarea";

type Msg = { id: string; direction: "in" | "out"; body: string; mode: string; createdAt: string };
type Template = { id: string; name: string; purpose: string; body: string; approved: boolean };

type Props = { target: LeadTarget | null; onClose: () => void; onDone: () => void };

/**
 * Send from the lead card. With the WhatsApp Business API connected, messages go from the company
 * number. Until Meta approves it, this opens WhatsApp (click-to-chat) and the CRM logs the message.
 */
export function WhatsAppSheet({ target, onClose, onDone }: Props) {
  const id = target?.leadId;
  const status = useApi<{ apiEnabled: boolean }>(id ? "/whatsapp/status" : null);
  const convo = useApi<Msg[]>(id ? `/leads/${id}/whatsapp` : null);
  const templates = useApi<Template[]>(id ? "/whatsapp/templates" : null);
  const [body, setBody] = useState("");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsTemplate, setNeedsTemplate] = useState(false);

  useEffect(() => {
    if (!id) { setBody(""); setTemplate(""); setNeedsTemplate(false); }
  }, [id]);

  // Oldest at the top, newest at the bottom, like a chat; opens scrolled to the latest message.
  const messages = useMemo(() => [...(convo.data ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [convo.data]);
  const chat = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [messages, target]);

  const apiEnabled = status.data?.apiEnabled ?? false;
  const approved = (templates.data ?? []).filter((t) => t.approved);

  async function send() {
    if (!target || !body.trim()) return;
    setBusy(true);
    try {
      const res = await apiClient.post<{ mode: string; url?: string }>(`/leads/${target.leadId}/whatsapp`, {
        body: body.trim(),
        template: template || null,
      });
      if (res.data.mode === "click_to_chat" && res.data.url) window.open(res.data.url, "_blank", "noopener");
      toast.success(res.data.mode === "api" ? "Message sent" : "Opened WhatsApp. Message logged.");
      setBody(""); setTemplate("");
      void convo.reload();
      onDone();
    } catch (e) {
      if ((errorData<{ code?: string }>(e))?.code === "template_required") setNeedsTemplate(true);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!target} title="WhatsApp" subtitle={target?.name} icon={MessageCircle} tone="emerald" onClose={onClose} width="lg">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          {apiEnabled
            ? "The client will see the company WhatsApp number, not your personal number."
            : "WhatsApp API is not connected yet. This opens WhatsApp with your message ready, and the CRM logs it."}
        </p>
        {/* the conversation: tall enough to read, wrapped so nothing scrolls sideways */}
        <div ref={chat} className="h-[min(48vh,26rem)] space-y-2 overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200/70 bg-[#f4f1ec] p-3 sm:p-4">
          {convo.loading && !convo.data ? (
            <p className="py-16 text-center text-sm text-slate-400">Loading messages…</p>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-emerald-600 shadow-sm"><MessageCircle className="h-5 w-5" /></span>
              <p className="text-sm text-slate-500">No messages yet. Your first message starts the chat.</p>
            </div>
          ) : (
            messages.map((m, i) => {
              const day = formatDate(m.createdAt);
              const newDay = i === 0 || formatDate(messages[i - 1].createdAt) !== day;
              const out = m.direction === "out";
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="my-2 flex justify-center">
                      <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm">{day}</span>
                    </div>
                  )}
                  <div className={cn("flex", out ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm", out ? "rounded-br-md bg-[#d9fdd3] text-slate-900" : "rounded-bl-md bg-white text-slate-900")}>
                      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body}</p>
                      <p className="mt-0.5 text-right text-[10px] text-slate-500">{formatTime(m.createdAt)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {apiEnabled && approved.length > 0 && (
          <SelectField
            label={needsTemplate ? "Pick a template (24-hour window is closed)" : "Template (optional)"}
            value={template}
            placeholder="Free text"
            options={approved.map((t) => ({ value: t.name, label: t.name.replaceAll("_", " ") }))}
            onChange={(e) => {
              setTemplate(e.target.value);
              const t = approved.find((x) => x.name === e.target.value);
              if (t) setBody(t.body);
            }}
          />
        )}
        <VoiceTextarea label="Message" value={body} onChange={setBody} rows={3} placeholder="Write your message" />
        <Button onClick={send} loading={busy} disabled={!body.trim()} className="w-full">
          <MessageCircle className="h-4 w-4" /> {apiEnabled ? "Send" : "Open WhatsApp"}
        </Button>
      </div>
    </Sheet>
  );
}
