"use client";
import { MessageCircle, Phone } from "lucide-react";
import { CALL_TONE, CONTACT_ICON, WHATSAPP_TONE } from "@/lib/contact-styles";
import { cn } from "@/lib/utils";

type Props = { onCall: () => void; onWhatsApp: () => void; disabled?: boolean };

/** One-tap Call and WhatsApp, shown on every lead item. */
export function ContactButtons({ onCall, onWhatsApp, disabled }: Props) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onCall}
        disabled={disabled}
        aria-label="Call"
        className={cn(CONTACT_ICON, CALL_TONE)}
      >
        <Phone className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onWhatsApp}
        aria-label="WhatsApp"
        className={cn(CONTACT_ICON, WHATSAPP_TONE)}
      >
        <MessageCircle className="h-4 w-4" />
      </button>
    </div>
  );
}
