"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types/api";
import { navFor, profileItem } from "./nav";

/** Phone navigation: the four main screens plus Profile, always one tap away. */
export function BottomNav({ user }: { user: Profile }) {
  const path = usePathname();
  const items = [...navFor(user.role).slice(0, 4), profileItem];
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
