"use client";
import { MessageCircle, Phone } from "lucide-react";

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
        className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
      >
        <Phone className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onWhatsApp}
        aria-label="WhatsApp"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 text-green-700 hover:bg-green-100"
      >
        <MessageCircle className="h-4 w-4" />
      </button>
    </div>
  );
}
