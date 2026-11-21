"use client";
import { use } from "react";
import { DealPage } from "@/components/lead/deal-page";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  return <DealPage id={use(params).id} area="projects" />;
}
