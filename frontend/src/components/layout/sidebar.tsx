"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types/api";
import type { FollowUpCounts } from "@/types/crm";
import { navFor } from "./nav";

const FOLLOW_UPS = "/follow-ups";
const REFRESH_MS = 60_000;

/** Overdue follow-ups for the red badge next to Follow-ups. Refreshed on every page change and once a minute. */
function useOverdueCount(enabled: boolean, path: string): number {
  const counts = useApi<FollowUpCounts>(enabled ? `${FOLLOW_UPS}/counts` : null);
  const reload = useRef(counts.reload);
  reload.current = counts.reload;
  const first = useRef(true);
  useEffect(() => {
    if (!enabled) return;
    if (first.current) first.current = false; // the first load is already under way
    else void reload.current();
  }, [enabled, path]);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => void reload.current(), REFRESH_MS);
    return () => clearInterval(t);
  }, [enabled]);
  return counts.data?.overdue ?? 0;
}

type Props = { user: Profile; collapsed: boolean; onToggle: () => void };

/**
 * Full menu, or just icons. The round arrow sits on the menu's right border, halfway down, in both states:
 * it is always in the same place relative to the edge, so there is never a hunt for it.
 * In icon mode each item shows its name in a tooltip on hover or keyboard focus.
 */
export function Sidebar({ user, collapsed, onToggle }: Props) {
  const path = usePathname();
  const items = navFor(user.role); // Profile lives in the user menu (top right)
  const overdue = useOverdueCount(items.some((i) => i.href === FOLLOW_UPS), path);
  return (
    <aside
      className={cn(
        "relative z-30 hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ease-out md:flex",
        collapsed ? "w-[4.5rem]" : "w-60",
      )}
    >
      <div className={cn("flex h-14 items-center", collapsed ? "justify-center" : "px-4")}>
        <div className="flex items-center gap-2.5 overflow-hidden">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">T</span>
          {!collapsed && <span className="truncate text-base font-bold tracking-tight text-slate-900">TOFAA CRM</span>}
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 pt-2" aria-label="Main">
        {items.map(({ href, label, icon: Icon }) => {
          const active = path.startsWith(href);
          const badge = href === FOLLOW_UPS && overdue > 0 ? (overdue > 99 ? "99+" : String(overdue)) : null;
          return (
            <Link
              key={href}
              href={href}
              aria-label={collapsed ? (badge ? `${label}, ${badge} overdue` : label) : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center rounded-xl text-sm font-medium transition-colors",
                collapsed ? "h-11 justify-center" : "gap-3 px-3 py-2.5",
                active ? "bg-brand-soft text-brand" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              <Icon className="h-[1.15rem] w-[1.15rem] shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
              {badge && !collapsed && (
                <span className="ml-auto shrink-0 rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white" title={`${badge} overdue`}>{badge}</span>
              )}
              {badge && collapsed && (
                <span aria-hidden="true" className="absolute right-1.5 top-1 min-w-[1.1rem] rounded-full bg-red-600 px-1 py-0.5 text-center text-[10px] font-semibold leading-none text-white ring-2 ring-white">{badge}</span>
              )}
              {collapsed && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-float transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {label}{badge ? ` · ${badge} overdue` : ""}
                  <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 bg-slate-900" aria-hidden="true" />
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* The toggle sits on the right border. Its vertical position is a plain `top` (33px centre minus half its height), never a translate: the press effect (.pressable) replaces `transform`, which used to drop the button by half its height on mouse-down and sometimes lose the click. */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? "Expand menu" : "Collapse menu"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand menu" : "Collapse menu"}
        className="pressable absolute -right-3 top-[21px] z-40 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-card transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-brand"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>
    </aside>
  );
}
