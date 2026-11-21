"use client";
import type { ReactNode } from "react";
import { moduleConfig, type ModuleConfig } from "@/features/modules/module-config";
import { useAppSelector } from "@/store/hooks";
import { EmptyState } from "../ui/empty-state";

/** Route guard: renders children only when the user's role may open the module. */
export function ModuleGate({ moduleKey, children }: { moduleKey: string; children: (config: ModuleConfig) => ReactNode }) {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const config = moduleConfig[moduleKey];
  if (!config) return <EmptyState title="Page not found" />;
  if (!user || !config.roles.includes(user.role)) return <EmptyState title="You do not have access to this page" />;
  return <>{children(config)}</>;
}
