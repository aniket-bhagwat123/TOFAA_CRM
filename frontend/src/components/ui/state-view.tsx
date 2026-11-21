import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

type Props = {
  kind: "empty" | "error";
  title?: string;
  message?: string;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
};

/** What a screen shows when there is nothing to list, or the list could not be loaded: a picture, a clear line, a way forward. */
export function StateView({ kind, title, message, onRetry, action, className }: Props) {
  const error = kind === "error";
  return (
    <div role={error ? "alert" : "status"} className={cn("flex min-h-[18rem] flex-1 flex-col items-center justify-center px-4 py-10 text-center", className)}>
      {error ? <ErrorArt /> : <EmptyArt />}
      <h2 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">{title ?? (error ? "We couldn't load this" : "No data found")}</h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">
        {message ?? (error ? "Something went wrong while loading. Please try again." : "There is nothing here yet.")}
      </p>
      {(onRetry || action) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry && <Button variant="secondary" onClick={onRetry}><RefreshCw className="h-4 w-4" /> Try again</Button>}
          {action}
        </div>
      )}
    </div>
  );
}

function EmptyArt() {
  return (
    <svg viewBox="0 0 200 150" className="h-36 w-auto" fill="none" aria-hidden="true">
      <ellipse cx="100" cy="132" rx="62" ry="9" fill="#D6E9F5" />
      <rect x="44" y="40" width="96" height="76" rx="14" fill="#EEF6FB" stroke="#AED3EA" strokeWidth="2" />
      <rect x="56" y="54" width="48" height="8" rx="4" fill="#7AB6D9" />
      <rect x="56" y="70" width="72" height="6" rx="3" fill="#AED3EA" />
      <rect x="56" y="84" width="60" height="6" rx="3" fill="#D6E9F5" />
      <rect x="56" y="98" width="40" height="6" rx="3" fill="#D6E9F5" />
      <circle cx="136" cy="88" r="24" fill="#fff" stroke="#2273A6" strokeWidth="5" />
      <path d="M154 106l18 18" stroke="#2273A6" strokeWidth="7" strokeLinecap="round" />
      <path d="M127 88h18" stroke="#7AB6D9" strokeWidth="5" strokeLinecap="round" />
      <circle cx="40" cy="30" r="4" fill="#AED3EA" />
      <circle cx="168" cy="38" r="3" fill="#7AB6D9" />
    </svg>
  );
}

function ErrorArt() {
  return (
    <svg viewBox="0 0 200 150" className="h-36 w-auto" fill="none" aria-hidden="true">
      <ellipse cx="100" cy="132" rx="62" ry="9" fill="#fee2e2" />
      <path d="M58 98a26 26 0 0 1 3-51 36 36 0 0 1 69-6 28 28 0 0 1 10 57Z" fill="#EEF6FB" stroke="#AED3EA" strokeWidth="2" />
      <circle cx="100" cy="86" r="22" fill="#fff" stroke="#ef4444" strokeWidth="5" />
      <path d="M100 74v14" stroke="#ef4444" strokeWidth="6" strokeLinecap="round" />
      <circle cx="100" cy="97" r="3.6" fill="#ef4444" />
      <path d="M52 112l-6 10M66 114l-4 10M150 112l6 10M136 114l4 10" stroke="#fca5a5" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
