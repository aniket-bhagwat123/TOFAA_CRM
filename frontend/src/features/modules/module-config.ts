import type { ApiRecord, Profile, Role } from "@/types/api";

export type ModuleField = {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "textarea";
  required?: boolean;
};

export type ModuleAction = { label: string; path: string; tone?: "default" | "danger" };

export type ModuleConfig = {
  roles: Role[];
  title: string;
  singular?: string;
  description: string;
  emptyHint?: string;
  endpoint: (user: Profile) => string;
  columns: string[];
  createFields?: ModuleField[];
  updateFields?: ModuleField[];
  updateMethod?: "patch" | "put";
  updateEndpoint?: (endpoint: string, record: ApiRecord) => string;
  deletePath?: (endpoint: string, id: string) => string;
  actions?: (row: ApiRecord, user: Profile) => ModuleAction[];
  modalWidth?: "sm" | "md" | "lg" | "xl";
  pageSize?: number;
};

/**
 * Registry that drives generic list pages at /<key>. Add one entry per simple list screen, e.g.
 *
 *   customers: {
 *     roles: ["admin"], title: "Customers", description: "...",
 *     endpoint: () => "/customers", columns: ["name", "email"],
 *   }
 */
export const moduleConfig: Record<string, ModuleConfig> = {};
