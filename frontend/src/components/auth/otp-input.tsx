"use client";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export const OTP_LENGTH = 6;

type Props = { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; error?: boolean };

/** Six boxes that behave like one field: paste, autofill (SMS / email code), backspace and arrows all work. */
export function OtpInput({ value, onChange, onComplete, disabled, error }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? "");

  useEffect(() => {
    refs.current[Math.min(value.length, OTP_LENGTH - 1)]?.focus();
  }, [value.length]);

  function commit(next: string) {
    const clean = next.replace(/\D/g, "").slice(0, OTP_LENGTH);
    onChange(clean);
    if (clean.length === OTP_LENGTH) onComplete?.(clean);
  }

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="One-time code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          pattern="\d*"
          maxLength={OTP_LENGTH} // lets a full code autofill into the first box
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (v.length > 1) return commit(v); // paste or autofill
            commit(value.slice(0, i) + v + value.slice(i + 1));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d && i > 0) {
              e.preventDefault();
              commit(value.slice(0, i - 1));
            }
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < OTP_LENGTH - 1) refs.current[i + 1]?.focus();
          }}
          className={cn(
            "h-14 w-full min-w-0 rounded-xl border bg-white text-center text-2xl font-semibold tabular-nums outline-none transition-all",
            "focus:border-brand focus:ring-4 focus:ring-brand/15",
            d ? "border-brand/50" : "border-slate-300/80",
            error && "border-red-400 ring-4 ring-red-100",
          )}
        />
      ))}
    </div>
  );
}
