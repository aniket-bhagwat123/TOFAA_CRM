"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";

/** The lead form is a side panel on the Leads screen. This old address just opens it. */
export default function NewLeadRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/leads?new=1"), [router]);
  return <div className="flex justify-center py-20"><Spinner /></div>;
}
