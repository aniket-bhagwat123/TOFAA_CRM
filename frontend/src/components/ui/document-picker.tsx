"use client";
import { FileText, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { RequiredMark } from "./required-mark";

const MAX = 10 * 1024 * 1024;
const OK = /\.(pdf|docx|jpe?g|png|webp)$/i;

type Props = { label: string; file: File | null; onChange: (f: File | null) => void; error?: string; required?: boolean; hint?: string };

/** Attach a PDF, Word or image file (10 MB at most). Checked here for a quick message; the server checks it again. */
export function DocumentPicker({ label, file, onChange, error, required, hint = "PDF, Word (.docx) or image. 10 MB at most." }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  function pick(f?: File) {
    if (!f) return;
    if (!OK.test(f.name)) return setProblem("Use a PDF, Word (.docx) or image file.");
    if (f.size > MAX) return setProblem("The file must be 10 MB or smaller.");
    setProblem(null);
    onChange(f);
  }

  const shown = problem ?? error;
  return (
    <div className="space-y-1">
      <span className="block text-sm font-medium text-slate-700">
        {label}
        {required && <RequiredMark />}
      </span>
      <input ref={input} type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,.webp" hidden onChange={(e) => { pick(e.target.files?.[0]); if (input.current) input.current.value = ""; }} />
      {file ? (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
          <FileText className="h-5 w-5 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-800">{file.name}</div>
            <div className="text-xs text-slate-400">{(file.size / 1024).toFixed(0)} KB</div>
          </div>
          <button type="button" onClick={() => onChange(null)} aria-label="Remove file" className="pressable rounded-full p-1.5 text-slate-400 hover:bg-white hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn("pressable flex w-full items-center gap-3 rounded-xl border border-dashed px-3.5 py-3 text-left text-sm text-slate-500 hover:border-brand/50 hover:bg-brand-soft/50", shown ? "border-red-400" : "border-slate-300")}
        >
          <Paperclip className="h-4 w-4 shrink-0" /> Attach a file
        </button>
      )}
      {!shown && <p className="text-xs text-slate-400">{hint}</p>}
      {shown && <span role="alert" className="block text-xs font-medium text-red-600">{shown}</span>}
    </div>
  );
}
