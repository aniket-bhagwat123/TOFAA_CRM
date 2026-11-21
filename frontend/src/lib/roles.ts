import type { Role } from "@/types/api";

export const homeFor = (role: Role) =>
  role === "finance" ? "/payments" : role === "sales_manager" || role === "admin" ? "/team" : "/today";

export const isManager = (role: Role) => role === "sales_manager" || role === "admin";
export const hasLeadAccess = (role: Role) => role === "sales_executive" || role === "sales_manager" || role === "admin";
export const seesPayments = (role: Role) => role === "finance" || role === "admin";
