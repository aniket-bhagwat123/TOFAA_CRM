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
    async function poll() {
      try {
        const { data } = await apiClient.get<AppNotification[]>("/notifications");
        if (stopped || !data.length) return;
        data.forEach((n) => {
          toast(n.title, { description: n.body ?? undefined, action: n.link ? { label: "Open", onClick: () => router.push(n.link!) } : undefined });
          if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
            new Notification(n.title, { body: n.body ?? undefined });
          }
        });
        await apiClient.post("/notifications/read", { ids: data.map((n) => n.id) });
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
