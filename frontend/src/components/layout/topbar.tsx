"use client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCrumb } from "@/lib/crumb";
import { hasClientPicker, picksInHeader } from "@/lib/selected-client";
import type { Profile } from "@/types/api";
import { ClientSwitcher } from "./client-switcher";
import { NotificationBell } from "./notification-bell";
import { UserMenu } from "./user-menu";

const TITLES: [string, string][] = [
  ["/follow-ups", "Follow-ups"],
  ["/leads", "Leads"],
  ["/projects", "Projects"],
  ["/clients", "Client Management"],
  ["/people", "People"],
  ["/os/home", "Home"],
  ["/os/calendar", "Gift Calendar"],
  ["/os/ideas", "Gift Ideas"],
  ["/os/events", "Events"],
  ["/os/activity", "Activity"],
  ["/gifting-requests", "Gift Requests"],
  ["/banners", "Banners"],
  ["/activity", "Activity"],
  ["/dashboard", "Dashboard"],
  ["/quotations", "Quotations"],
  ["/orders", "Orders"],
  ["/approvals", "Approvals"],
  ["/reports", "Reports"],
  ["/my-target", "My Target"],
  ["/users", "Users"],
  ["/settings", "Settings"],
  ["/payments", "Payments"],
  ["/profile", "My profile"],
];

/** The module name for the current screen. Pages do not repeat it in their own body. */
export function titleFor(path: string): string {
  if (/^\/leads\/[^/]+/.test(path)) return "Lead";
  if (/^\/projects\/[^/]+/.test(path)) return "Project";
  if (/^\/clients\/[^/]+/.test(path)) return "Client";
  return TITLES.find(([p]) => path.startsWith(p))?.[1] ?? "TOFAA CRM";
}

export function Topbar({ user }: { user: Profile }) {
  const path = usePathname();
  const crumb = useCrumb();
  const showCrumb = crumb && crumb.path === path;
  return (
    <header className="material material-top sticky top-0 z-20 flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
      {showCrumb ? (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-base">
          <Link href={crumb.parent.href} className="shrink-0 font-medium text-slate-500 hover:text-brand">{crumb.parent.label}</Link>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
          <span className="truncate font-semibold tracking-tight text-slate-900" aria-current="page">{crumb.label}</span>
        </nav>
      ) : (
        <div className="min-w-0 truncate text-base font-semibold tracking-tight text-slate-900">{titleFor(path)}</div>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        {picksInHeader(user.role) && hasClientPicker(path) && <ClientSwitcher />}
        <NotificationBell />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
