"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";

/** Today now lives at the top of the Dashboard. Old links (bookmarks, notifications, "?eod=1") land there. */
export default function TodayRedirect() {
  const router = useRouter();
  useEffect(() => {
    const eod = new URLSearchParams(window.location.search).get("eod") === "1";
    router.replace(eod ? "/dashboard?eod=1" : "/dashboard");
  }, [router]);
  return <div className="flex justify-center py-12"><Spinner /></div>;
}
