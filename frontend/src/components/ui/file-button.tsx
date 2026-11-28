"use client";
/** A real button that opens the file chooser. The input is not displayed, so focusing it never scrolls the page. */
import { Loader2, Upload } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  onFiles: (files: File[]) => void;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
};

const OUTLINE = "pressable inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-brand/40 hover:text-brand disabled:opacity-40";

export function FileButton({ children, onFiles, accept, multiple, disabled, busy, className }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={cn(OUTLINE, className)} disabled={disabled || busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{busy ? "Uploading…" : children}
      </button>
      <input ref={input} type="file" accept={accept} multiple={multiple} className="hidden"
        onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) onFiles(files); }} />
    </>
  );
}
