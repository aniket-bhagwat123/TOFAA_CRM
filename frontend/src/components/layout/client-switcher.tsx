"use client";
import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import { FilterMenu } from "@/components/ui/filter-menu";
import { pickClient, pickedClient } from "@/lib/selected-client";
import { apiClient } from "@/services/api-client";
import type { ClientSummary } from "@/types/crm";

/** KAM and admin, in the header of the OS-side screens: one client at a time, or all of them. Searchable. */
export function ClientSwitcher() {
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null);
  const current = pickedClient();

  useEffect(() => {
    apiClient.get<ClientSummary[]>("/clients")
      .then((r) => {
        const list = r.data.map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
        setClients(list);
        const saved = pickedClient();
        if (saved && !list.some((c) => c.id === saved.id)) pickClient(null); // deleted, or no longer theirs
      })
      .catch(() => undefined); // the picker keeps the saved choice
  }, []);

  const options = [{ value: "", label: "All clients" }, ...(clients ?? (current ? [current] : [])).map((c) => ({ value: c.id, label: c.name }))];
  return (
    <FilterMenu icon={<Building2 className="h-4 w-4" />} label="Choose a client" searchable width={300} value={current?.id ?? ""} options={options}
      className="!h-9 !w-auto max-w-[11rem] sm:max-w-[16rem]"
      onChange={(id) => pickClient(clients?.find((c) => c.id === id) ?? null)} />
  );
}
