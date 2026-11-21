import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./spinner";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "tinted" | "danger" | "ghost";
  loading?: boolean;
};

const variants = {
  primary: "bg-brand text-white shadow-sm hover:bg-brand-dark",
  secondary: "border border-slate-300/80 bg-white text-slate-700 hover:bg-slate-50",
  tinted: "bg-slate-100 text-slate-800 hover:bg-slate-200/80", // Apple-style grey fill for quiet secondary actions
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export function Button({ variant = "primary", loading, className, children, disabled, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "pressable inline-flex min-h-[2.5rem] items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-60 [&_svg]:shrink-0",
        variants[variant],
        className,
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
