"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";

/** Import lives inside Leads now. Old links land there with the dialog open. */
export default function ImportRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/leads?import=1"), [router]);
  return <div className="flex justify-center py-20"><Spinner /></div>;
}
