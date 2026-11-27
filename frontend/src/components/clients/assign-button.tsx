import { UserCog, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Give a client to a KAM, or move it to another one (sales managers and admins). */
export function AssignButton({ assigned, name, onClick, className }: { assigned: boolean; name: string; onClick: () => void; className?: string }) {
  const Icon = assigned ? UserCog : UserPlus;
  const label = assigned ? "Reassign" : "Assign";
  return (
    <button type="button" onClick={onClick} aria-label={`${label} ${name}`} title={assigned ? "Move to another KAM" : "Assign to a KAM"}
      className={cn("pressable inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand/25 bg-brand-soft px-3 text-xs font-semibold text-brand hover:border-brand hover:bg-brand hover:text-white", className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
    </button>
  );
}
