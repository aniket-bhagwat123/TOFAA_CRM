"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types/api";
import { navFor, profileItem } from "./nav";

/** Phone navigation, 5 items at most: a short menu plus Profile, or the first five items of a longer one
 * (Profile is always in the top-right menu). */
export function BottomNav({ user }: { user: Profile }) {
  const path = usePathname();
  const menu = navFor(user.role);
  const items = menu.length >= 5 ? menu.slice(0, 5) : [...menu, profileItem];
  return (
    <nav className="material material-bottom safe-bottom fixed inset-x-0 bottom-0 z-30 flex md:hidden">
      {items.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "pressable flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-slate-500",
            path.startsWith(href) && "text-brand",
          )}
        >
          <Icon className="h-5 w-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
