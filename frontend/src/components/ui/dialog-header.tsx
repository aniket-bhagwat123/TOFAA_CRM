import { X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "violet" | "emerald" | "sky" | "amber" | "red" | "indigo";

const TONES: Record<Tone, { bar: string; icon: string }> = {
  violet: { bar: "from-violet-50", icon: "bg-violet-100 text-violet-600 ring-violet-200/60" },
  emerald: { bar: "from-emerald-50", icon: "bg-emerald-100 text-emerald-600 ring-emerald-200/60" },
  sky: { bar: "from-sky-50", icon: "bg-sky-100 text-sky-600 ring-sky-200/60" },
  amber: { bar: "from-amber-50", icon: "bg-amber-100 text-amber-600 ring-amber-200/60" },
  red: { bar: "from-red-50", icon: "bg-red-100 text-red-600 ring-red-200/60" },
  indigo: { bar: "from-indigo-50", icon: "bg-indigo-100 text-indigo-600 ring-indigo-200/60" },
};

type Props = { title: string; subtitle?: string; icon?: LucideIcon; tone?: Tone; onClose: () => void; className?: string };

/** Shared by every dialog: an icon in a tinted square, the title, a short line under it, and the close button. */
export function DialogHeader({ title, subtitle, icon: Icon, tone = "violet", onClose, className }: Props) {
  const t = TONES[tone];
  return (
    <div className={cn("flex items-center gap-3.5 bg-gradient-to-r to-white px-5 py-4", t.bar, className)}>
      {Icon && (
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1", t.icon)}>
          <Icon className="h-5 w-5" strokeWidth={2.2} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[1.05rem] font-semibold leading-tight tracking-tight text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="pressable shrink-0 rounded-full p-2 text-slate-400 hover:bg-white/80 hover:text-slate-700">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
