"use client";
import { use } from "react";
import { ModuleGate } from "@/components/modules/module-gate";
import { ModuleList } from "@/components/modules/module-list";

export default function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = use(params);
  return <ModuleGate moduleKey={module}>{(config) => <ModuleList config={config} />}</ModuleGate>;
}
