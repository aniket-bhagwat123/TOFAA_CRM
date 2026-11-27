"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types/api";
import { ModuleSwitch, useMenuModule } from "./module-switch";
import { navFor, navModules, profileItem } from "./nav";

/** Phone navigation, 5 items at most: a short menu plus Profile, or the first five items of a longer one
 * (Profile is always in the top-right menu). */
export function BottomNav({ user }: { user: Profile }) {
  const path = usePathname();
  const modules = navModules(user.role);
  const side = useMenuModule(path);
  const menu = modules ? modules[side] : navFor(user.role);
  const items = menu.length >= 5 ? menu.slice(0, 5) : [...menu, profileItem];
  return (
    <nav className="material material-bottom safe-bottom fixed inset-x-0 bottom-0 z-30 md:hidden">
      {modules && <ModuleSwitch value={side} home={{ crm: modules.crm[0], os: modules.os[0] }} className="mx-3 mt-2" />}
      <div className="flex">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "pressable flex flex-1 flex-col items-center gap-0.5 py-2 text-[12px] font-medium text-slate-500",
              path.startsWith(href) && "text-brand",
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
