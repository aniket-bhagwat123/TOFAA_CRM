"use client";
import { Phone } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import type { LeadTarget } from "./types";

type Props = { target: LeadTarget | null; onClose: () => void; onPick: (t: LeadTarget, phone: string) => void };

/** A contact with two numbers: choose which one to dial. The call outcome sheet opens after either. */
export function NumberPickerSheet({ target, onClose, onPick }: Props) {
  const numbers = [
    { phone: target?.phone, label: target?.contactName ? `${target.contactName} · Main number` : "Main number" },
    { phone: target?.altPhone, label: target?.altName ? `${target.altName} · Second number` : "Second number" },
  ].filter((n): n is { phone: string; label: string } => !!n.phone);

  return (
    <Sheet open={!!target} title="Which number?" subtitle={target?.name} icon={Phone} tone="emerald" onClose={onClose}>
      <div className="space-y-2.5">
        {numbers.map((n) => (
          <button
            key={n.phone}
            type="button"
            onClick={() => target && onPick(target, n.phone)}
            className="pressable flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left hover:border-brand/40 hover:bg-brand-soft"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white"><Phone className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block text-base font-semibold tabular-nums text-slate-900">{n.phone}</span>
              <span className="block text-xs text-slate-500">{n.label}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
