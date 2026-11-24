"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";

/** "Team" became the Dashboard; old links and bookmarks land there. */
export default function TeamRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/dashboard"); }, [router]);
  return <div className="flex justify-center py-20"><Spinner /></div>;
}
