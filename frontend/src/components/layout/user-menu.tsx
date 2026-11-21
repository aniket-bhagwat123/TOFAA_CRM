"use client";
import { ChevronDown, LogOut, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/features/auth/auth.service";
import { clearSession } from "@/features/auth/auth.slice";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "@/store/hooks";
import { ROLE_LABEL, type Profile } from "@/types/api";
import { Avatar } from "../ui/avatar";
import { Spinner } from "../ui/spinner";

/** Signed-in person: photo, name and role. Opens a menu with Profile and Sign out. */
export function UserMenu({ user }: { user: Profile }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const name = user.fullName ?? user.email ?? user.phone ?? "Account";

  useEffect(() => setOpen(false), [path]); // close after navigating

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function signOut() {
    setBusy(true);
    await logout();
    dispatch(clearSession());
    router.replace("/login");
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="pressable flex items-center gap-2.5 rounded-2xl py-1 pl-1 pr-2 hover:bg-slate-900/5"
      >
        <Avatar src={user.avatarUrl} name={name} size="sm" />
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-[10rem] truncate text-sm font-semibold leading-tight text-slate-900">{name}</span>
          <span className="block text-xs leading-tight text-slate-500">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronDown className={cn("hidden h-4 w-4 text-slate-400 transition-transform sm:block", open && "rotate-180")} />
      </button>

      {open && (
        <div role="menu" className="animate-pop absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-float">
          <div className="flex items-center gap-3 border-b border-slate-100 p-4">
            <Avatar src={user.avatarUrl} name={name} size="md" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
              <div className="text-xs text-slate-500">{ROLE_LABEL[user.role]}</div>
              {(user.email || user.phone) && <div className="truncate text-xs text-slate-400">{user.email ?? user.phone}</div>}
            </div>
          </div>
          <div className="p-1.5">
            <Link role="menuitem" href="/profile" className="pressable flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-100">
              <User className="h-4 w-4 text-slate-400" /> Profile
            </Link>
            <button role="menuitem" type="button" onClick={signOut} disabled={busy} className="pressable flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60">
              {busy ? <Spinner className="h-4 w-4" /> : <LogOut className="h-4 w-4" />} Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
