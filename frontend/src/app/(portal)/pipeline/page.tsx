"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";

/** Pipeline is now the Board tab of Leads. Old links land there. */
export default function PipelineRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/leads?view=board"), [router]);
  return <div className="flex justify-center py-20"><Spinner /></div>;
}
