"use client";
import { Briefcase, Gift, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FocusEvent, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { moduleOfPath, type MenuModule, type NavItem } from "./nav";

const KEY = "tofaa-menu-module";

/**
 * The side of the menu to show. The page decides it, so a link or bell alert that opens an OS page also switches
 * the menu. Pages that belong to neither side (Profile) keep the last one used on this device.
 */
export function useMenuModule(path: string): MenuModule {
  const fromPath = moduleOfPath(path);
  const [saved, setSaved] = useState<MenuModule>("crm");
  useEffect(() => {
    try {
      if (fromPath) window.localStorage.setItem(KEY, fromPath);
      setSaved(fromPath ?? (window.localStorage.getItem(KEY) === "os" ? "os" : "crm"));
    } catch { /* not remembered; the page still decides */ }
  }, [fromPath]);
  return fromPath ?? saved;
}

const SIDES: { value: MenuModule; label: string; icon: LucideIcon }[] = [
  { value: "crm", label: "CRM", icon: Briefcase },
  { value: "os", label: "OS", icon: Gift },
];

type Props = {
  value: MenuModule;
  /** The first page of each side: where switching to it goes. */
  home: Record<MenuModule, NavItem>;
  /** A red dot on a side that has something waiting, while the other side is open. */
  alert?: Partial<Record<MenuModule, string>>;
  /** Icon-only menu: the two sides stack, each named by the menu's tooltip. */
  collapsed?: boolean;
  onTip?: (text: string) => (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => void;
  onTipEnd?: () => void;
  className?: string;
};

/** The CRM / OS switch above the menu. */
export function ModuleSwitch({ value, home, alert, collapsed, onTip, onTipEnd, className }: Props) {
  return (
    <div role="group" aria-label="Module" className={cn("flex gap-1 rounded-xl bg-slate-100 p-1", collapsed && "flex-col", className)}>
      {SIDES.map(({ value: side, label, icon: Icon }) => {
        const selected = side === value;
        const note = selected ? undefined : alert?.[side];
        const name = note ? `${label}, ${note}` : label;
        return (
          <Link
            key={side}
            href={home[side].href}
            aria-current={selected ? "true" : undefined}
            aria-label={collapsed || note ? name : undefined}
            onMouseEnter={onTip?.(name)}
            onMouseLeave={onTipEnd}
            onFocus={onTip?.(name)}
            onBlur={onTipEnd}
            className={cn(
              "pressable relative flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors",
              selected ? "bg-brand text-white shadow-sm" : "text-slate-600 hover:bg-white",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && label}
            {note && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-600" />}
          </Link>
        );
      })}
    </div>
  );
}
