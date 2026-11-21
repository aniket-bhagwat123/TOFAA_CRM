import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { RequiredMark } from "./required-mark";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
  required?: boolean;
  options: { value: string; label: string }[];
  placeholder?: string;
};

export const SelectField = forwardRef<HTMLSelectElement, Props>(
  ({ label, error, required, options, placeholder, className, ...rest }, ref) => (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <RequiredMark />}
      </span>
      <select
        ref={ref}
        {...rest}
        aria-required={required || undefined}
        aria-invalid={!!error || undefined}
        className={cn(
          "w-full rounded-xl border border-slate-300/80 bg-white px-3.5 py-2.5 text-base outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 sm:text-sm",
          error && "border-red-400 ring-4 ring-red-100",
          className,
        )}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {error && <span role="alert" className="block text-xs font-medium text-red-600">{error}</span>}
    </label>
  ),
);
SelectField.displayName = "SelectField";
