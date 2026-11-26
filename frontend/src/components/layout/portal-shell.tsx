"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { setProfile } from "@/features/auth/auth.slice";
import { apiClient } from "@/services/api-client";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import type { Profile } from "@/types/api";
import { ReminderCenter } from "../followups/reminder-center";
import { Spinner } from "../ui/spinner";
import { BottomNav } from "./bottom-nav";
import { navFor, navModules } from "./nav";
import { cn } from "@/lib/utils";
import { SessionGuards } from "./session-guards";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/** Portal layout with auth guard: redirects to /login when there is no session. */
export function PortalShell({ children }: { children: ReactNode }) {
  const { session, ready } = useAppSelector((s) => s.auth);
  const router = useRouter();
  const dispatch = useAppDispatch();
  // Menu size is remembered per browser: full menu, or icons only.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem("tofaa-menu-collapsed") === "1"); } catch { /* storage unavailable */ } }, []);
  const toggleMenu = () => setCollapsed((c) => { try { localStorage.setItem("tofaa-menu-collapsed", c ? "0" : "1"); } catch { /* ignore */ } return !c; });

  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  // Photo links are short-lived, so fetch a fresh profile whenever the app opens.
  const signedIn = !!session;
  useEffect(() => {
    if (!signedIn) return;
    apiClient.get<Profile>("/auth/me").then((r) => dispatch(setProfile(r.data))).catch(() => undefined);
  }, [signedIn, dispatch]);

  if (!ready || !session) {
    return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
  }
  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar user={session.profile} collapsed={collapsed} onToggle={toggleMenu} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={session.profile} />
        {/* The phone menu is taller for roles with the CRM / OS switch */}
        <main className={cn("min-h-0 flex-1 overflow-y-auto p-4 md:p-6 md:pb-6", navModules(session.profile.role) ? "pb-36" : "pb-24")}>{children}</main>
      </div>
      <BottomNav user={session.profile} />
      <SessionGuards />
      {/* Ringing reminders for anyone who has Follow-ups in their menu */}
      <ReminderCenter enabled={navFor(session.profile.role).some((i) => i.href === "/follow-ups")} />
    </div>
  );
}
