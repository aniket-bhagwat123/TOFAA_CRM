import type { Role } from "@/types/api";

export const homeFor = (role: Role) =>
  role === "finance" ? "/payments" : "/dashboard"; // for a KAM, "Today" is the top of the Dashboard

export const isManager = (role: Role) => role === "sales_manager" || role === "admin";
/** Handing a lead to someone else: managers, admins, and KAMs for their own leads. */
export const canAssignLeads = (role: Role) => isManager(role) || role === "kam";
/** Owner and tier, delete, campaigns: managers, admins, and KAMs on their own accounts. */
export const canManageClients = (role: Role) => isManager(role) || role === "kam";
/** Deleting people and groups: sales managers and admins (a KAM archives). */
export const canDeletePeople = (role?: Role) => !!role && isManager(role);
export const hasLeadAccess = (role: Role) => role === "sales_manager" || role === "admin" || role === "kam";
/** Activity is for managers and admins: KAMs never see it. */
export const seesActivity = (role?: Role) => role === "sales_manager" || role === "admin";
export const seesPayments = (role: Role) => role === "finance" || role === "admin";
