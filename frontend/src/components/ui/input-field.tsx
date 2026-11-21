import { forwardRef, type ChangeEvent, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { clampPhone } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { RequiredMark } from "./required-mark";

type Common = { label: string; error?: string; required?: boolean };
type InputProps = Common & InputHTMLAttributes<HTMLInputElement> & { integer?: boolean; hideLabel?: boolean };

const base =
  "w-full rounded-xl border border-slate-300/80 bg-white px-3.5 py-2.5 text-base outline-none transition-shadow placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/15 sm:text-sm";

const NO_PLACEHOLDER = new Set(["date", "datetime-local", "time", "month", "week", "file", "checkbox", "radio", "hidden", "color", "range"]);
const cleanLabel = (label: string) => label.replace(/\s*\(optional\)/i, "").replace(/[?:]+$/, "").trim().toLowerCase();

/** A plain prompt made from the label: "Company" becomes "Enter company". Never an example value. */
export function placeholderFor(label: string, type?: string, readOnly?: boolean): string | undefined {
  if (readOnly || (type && NO_PLACEHOLDER.has(type))) return undefined;
  const text = cleanLabel(label);
  if (text.startsWith("confirm ")) return `Re-enter ${text.slice(8)}`;
  return `Enter ${text}`;
}

/** Digits only (and one decimal point unless the field is whole numbers): no minus sign, no letters, no "e". */
export function cleanNumber(value: string, integer?: boolean): string {
  let v = value.replace(integer ? /[^\d]/g : /[^\d.]/g, "");
  if (!integer) {
    const dot = v.indexOf(".");
    if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
  }
  return v;
}

/**
 * Number fields are text boxes that only accept digits. That means no spinner arrows, scrolling over the
 * field never changes it, and a negative number cannot be typed or pasted.
 */
export const InputField = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, required, className, integer, hideLabel, type, onChange, ...rest }, ref) => {
    const numeric = type === "number";
    const phone = type === "tel";
    const handleChange = phone
      ? (e: ChangeEvent<HTMLInputElement>) => {
          const cleaned = clampPhone(e.target.value);
          if (cleaned !== e.target.value) e.target.value = cleaned; // digits only, at most 10
          onChange?.(e);
        }
      : numeric
      ? (e: ChangeEvent<HTMLInputElement>) => {
          const cleaned = cleanNumber(e.target.value, integer);
          if (cleaned !== e.target.value) e.target.value = cleaned; // the handler below reads the cleaned value
          onChange?.(e);
        }
      : onChange;
    return (
      <label className="block space-y-1">
        <span className={cn("text-sm font-medium text-slate-700", hideLabel && "sr-only")}>
          {label}
          {required && <RequiredMark />}
        </span>
        <input
          ref={ref}
          placeholder={placeholderFor(label, type, rest.readOnly)}
          {...rest}
          type={numeric ? "text" : type}
          inputMode={phone ? "numeric" : numeric ? (integer ? "numeric" : "decimal") : rest.inputMode}
          onChange={handleChange}
          onWheel={numeric ? (e) => (e.currentTarget as HTMLInputElement).blur() : rest.onWheel}
          aria-required={required || undefined}
          aria-invalid={!!error || undefined}
          className={cn(base, error && "border-red-400 ring-4 ring-red-100", className)}
        />
        {error && <span role="alert" className="block text-xs font-medium text-red-600">{error}</span>}
      </label>
    );
  },
);
InputField.displayName = "InputField";

export const TextareaField = forwardRef<HTMLTextAreaElement, Common & TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ label, error, required, className, ...rest }, ref) => (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <RequiredMark />}
      </span>
      <textarea
        ref={ref}
        rows={3}
        placeholder={`Add ${cleanLabel(label)}`}
        {...rest}
        aria-required={required || undefined}
        aria-invalid={!!error || undefined}
        className={cn(base, error && "border-red-400 ring-4 ring-red-100", className)}
      />
      {error && <span role="alert" className="block text-xs font-medium text-red-600">{error}</span>}
    </label>
  ),
);
TextareaField.displayName = "TextareaField";
