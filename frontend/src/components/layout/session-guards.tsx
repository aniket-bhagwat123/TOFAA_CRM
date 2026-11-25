"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { logout } from "@/features/auth/auth.service";
import { clearSession } from "@/features/auth/auth.slice";
import { hasLeadAccess } from "@/lib/roles";
import { apiClient } from "@/services/api-client";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import type { AppNotification } from "@/types/crm";

const DESKTOP_IDLE_MIN = 30; // PRD default for desktop
const MOBILE_IDLE_MIN = 12 * 60; // longer on mobile
const POLL_MS = 60_000;

/** Auto-logout after inactivity, plus in-app reminders (browser notification if allowed). */
export function SessionGuards() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const last = useRef(Date.now());

  useEffect(() => {
    const touch = () => (last.current = Date.now());
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(async () => {
      const mobile = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
      const limit = (mobile ? MOBILE_IDLE_MIN : DESKTOP_IDLE_MIN) * 60_000;
      if (Date.now() - last.current > limit) {
        await logout();
        dispatch(clearSession());
        toast.info("Signed out after inactivity.");
        router.replace("/login");
      }
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(timer);
    };
  }, [dispatch, router]);

  useEffect(() => {
    if (!role || !hasLeadAccess(role)) return;
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    let stopped = false;
    const SEEN_KEY = "notifications.popped";
    const seen = new Set<string>((() => { try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]") as string[]; } catch { return []; } })());
    const saveSeen = () => { try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200))); } catch { /* private mode */ } };
    async function poll() {
      try {
        const { data } = await apiClient.get<AppNotification[]>("/notifications");
        // Pop each new alert once. It stays unread in the bell (top bar) until it is opened or marked read there.
        const fresh = data.filter((n) => !seen.has(n.id));
        fresh.forEach((n) => seen.add(n.id));
        saveSeen();
        if (stopped || !fresh.length) return;
        fresh.forEach((n) => {
          toast(n.title, { description: n.body ?? undefined, action: n.link ? { label: "Open", onClick: () => router.push(n.link!) } : undefined });
          if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
            new Notification(n.title, { body: n.body ?? undefined });
          }
        });
      } catch {
        /* offline: try again next tick */
      }
    }
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [role, router]);

  return null;
}
