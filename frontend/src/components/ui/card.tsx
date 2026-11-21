import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export const Card = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
  <div {...rest} className={cn("rounded-2xl border border-slate-200/70 bg-white p-5 shadow-card", className)} />
);
