import type { Role } from "@/types/api";

export const homeFor = (role: Role) =>
  role === "finance" ? "/payments" : role === "kam" ? "/clients" : role === "sales_manager" || role === "admin" ? "/dashboard" : "/today";

export const isManager = (role: Role) => role === "sales_manager" || role === "admin";
export const hasLeadAccess = (role: Role) => role === "sales_executive" || role === "sales_manager" || role === "admin" || role === "kam";
/** Activity is for managers and admins: executives and KAMs never see it. */
export const seesActivity = (role?: Role) => role === "sales_manager" || role === "admin";
export const seesPayments = (role: Role) => role === "finance" || role === "admin";
