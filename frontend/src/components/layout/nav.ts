import { BarChart3, Users, Building2, CalendarCheck, CalendarClock, FolderKanban, History, KanbanSquare, Settings, User, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/types/api";

export type NavItem = { href: string; label: string; icon: LucideIcon };

const today = { href: "/today", label: "Today", icon: CalendarCheck };
const leads = { href: "/leads", label: "Leads", icon: KanbanSquare };
const clients = { href: "/clients", label: "Clients", icon: Building2 };
const projects = { href: "/projects", label: "Projects", icon: FolderKanban };
const followUps = { href: "/follow-ups", label: "Follow-ups", icon: CalendarClock };
const activity = { href: "/activity", label: "Activity", icon: History };
const team = { href: "/team", label: "Team", icon: BarChart3 };
const payments = { href: "/payments", label: "Payments", icon: Wallet };
const users = { href: "/users", label: "Users", icon: Users };
const settings = { href: "/settings", label: "Settings", icon: Settings };
export const profileItem = { href: "/profile", label: "Profile", icon: User };

export function navFor(role: Role): NavItem[] {
  switch (role) {
    case "sales_executive":
      return [today, leads, followUps, clients, projects, activity];
    case "sales_manager":
      return [team, today, leads, followUps, clients, projects, activity];
    case "admin":
      return [team, leads, followUps, clients, projects, payments, users, settings, activity];
    case "finance":
      return [payments]; // Finance sees payment-related data only
    default:
      return [];
  }
}
