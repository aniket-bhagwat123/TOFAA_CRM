import { STAGE_LABEL, STAGE_TONE } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StageKey } from "@/types/crm";

export const StageBadge = ({ stage, className }: { stage: StageKey; className?: string }) => (
  <span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", STAGE_TONE[stage], className)}>
    {STAGE_LABEL[stage]}
  </span>
);
