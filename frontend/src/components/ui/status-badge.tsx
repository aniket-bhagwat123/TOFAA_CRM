import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-700",
};

export const StatusBadge = ({ status }: { status: string }) => (
  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", tones[status] ?? tones.draft)}>
    {status}
  </span>
);
