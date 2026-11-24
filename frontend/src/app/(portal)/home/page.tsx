"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";
import { homeFor } from "@/lib/roles";
import { useAppSelector } from "@/store/hooks";

/** Executives land on Today, managers and admins on the Dashboard. */
export default function HomePage() {
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const router = useRouter();
  useEffect(() => {
    if (role) router.replace(homeFor(role));
  }, [role, router]);
  return <div className="flex justify-center py-20"><Spinner /></div>;
}
