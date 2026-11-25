import { BadgeCheck, BarChart3, Contact, Image as ImageIcon, Target, Building2, CalendarClock, FileText, History, KanbanSquare, LayoutDashboard, PackageCheck, Settings, User, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/types/api";

export type NavItem = { href: string; label: string; icon: LucideIcon };

const leads = { href: "/leads", label: "Leads", icon: KanbanSquare };
const clients = { href: "/clients", label: "Clients", icon: Building2 };
const followUps = { href: "/follow-ups", label: "Follow-ups", icon: CalendarClock };
const activity = { href: "/activity", label: "Activity", icon: History };
const dashboard = { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard };
const quotations = { href: "/quotations", label: "Quotations", icon: FileText };
const orders = { href: "/orders", label: "Orders", icon: PackageCheck };
const approvals = { href: "/approvals", label: "Approvals", icon: BadgeCheck };
const reports = { href: "/reports", label: "Reports", icon: BarChart3 };
const myTarget = { href: "/my-target", label: "My Target", icon: Target };
const myAccounts = { href: "/clients", label: "My Accounts", icon: Building2 };
const payments = { href: "/payments", label: "Payments", icon: Wallet };
const users = { href: "/users", label: "Users", icon: Users };
const settings = { href: "/settings", label: "Settings", icon: Settings };
const people = { href: "/people", label: "People", icon: Contact }; // KAM and admin
const banners = { href: "/banners", label: "Banners", icon: ImageIcon }; // KAM and admin
export const profileItem = { href: "/profile", label: "Profile", icon: User };

/**
 * Menu per role. Each person sees only their own items: executives never see Users, Settings or Activity.
 * Screens left out of a menu (Clients, Projects, Orders for sales) stay reachable from the links inside the app
 * (a follow-up opens its client, a lead its project), so no working flow breaks.
 * Every role has its own Dashboard first (built from its own modules' data).
 * Landing: executive on Today, manager and Superadmin on Dashboard, Finance on Payments, KAM on My Accounts (lib/roles.ts).
 */
export function navFor(role: Role): NavItem[] {
  switch (role) {
    case "sales_executive":
      return [dashboard, leads, followUps, quotations, myTarget]; // "Today" is the top of their Dashboard
    case "sales_manager":
      return [dashboard, leads, followUps, quotations, approvals, reports];
    case "admin":
      return [dashboard, leads, followUps, clients, people, quotations, orders, payments, approvals, reports, users, banners, settings, activity];
    case "finance":
      return [dashboard, payments];
    case "kam":
      return [dashboard, myAccounts, people, orders, followUps, banners]; // their accounts, those accounts' people and orders, their follow-ups
    default:
      return [];
  }
}
