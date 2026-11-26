import { BadgeCheck, BarChart3, Gift, Contact, Image as ImageIcon, Target, Building2, CalendarClock, FileText, History, KanbanSquare, LayoutDashboard, PackageCheck, Settings, User, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/types/api";

export type MenuModule = "crm" | "os";
export type NavItem = { href: string; label: string; icon: LucideIcon; module?: MenuModule }; // no module = CRM

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
// The OS side of the menu (KAM and admin): everything that feeds or comes from Gifting OS.
const people: NavItem = { href: "/people", label: "People", icon: Contact, module: "os" };
const banners: NavItem = { href: "/banners", label: "Banners", icon: ImageIcon, module: "os" };
const giftRequests: NavItem = { href: "/gifting-requests", label: "Gift Requests", icon: Gift, module: "os" };
const OS_PAGES = [giftRequests, people, banners];
const NEUTRAL_PAGES = ["/profile"]; // belong to neither side: the menu stays as it was
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
      return [dashboard, leads, followUps, clients, people, giftRequests, quotations, orders, payments, approvals, reports, users, banners, settings, activity];
    case "finance":
      return [dashboard, payments];
    case "kam":
      return [dashboard, myAccounts, people, giftRequests, orders, followUps, banners]; // their accounts, those accounts' people and orders, their follow-ups
    default:
      return [];
  }
}

/** The side a page belongs to, or null for a page shared by both. */
export function moduleOfPath(path: string): MenuModule | null {
  const under = (href: string) => path === href || path.startsWith(`${href}/`);
  if (OS_PAGES.some((i) => under(i.href))) return "os";
  return NEUTRAL_PAGES.some(under) ? null : "crm";
}

/** The menu split by side, or null for a role with nothing in the OS (it then sees one menu, without a switch). */
export function navModules(role: Role): Record<MenuModule, NavItem[]> | null {
  const items = navFor(role);
  const os = OS_PAGES.filter((page) => items.includes(page)); // in the order of OS_PAGES: Gift Requests opens first
  return os.length ? { crm: items.filter((i) => i.module !== "os"), os } : null;
}
