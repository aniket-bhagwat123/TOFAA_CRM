"use client";
import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ClientSetup } from "@/components/os/client-setup";
import { FilterMenu } from "@/components/ui/filter-menu";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { pickedClient, picksInHeader } from "@/lib/selected-client";
import { useAppSelector } from "@/store/hooks";

const KEY = "tofaa-os-client"; // the client a sales manager last looked at, in this browser
/** "All clients": every client the person may see, together. */
export const ALL_CLIENTS = "all";
export const osAllowed = (role?: string) => role === "admin" || role === "sales_manager" || role === "kam";

/**
 * The OS modules show one client's Gifting OS data. A KAM or admin picks it in the header; a sales manager picks it
 * here. Renders `children` with the chosen client's id, or ALL_CLIENTS to show them all.
 */
export function ClientGate({ children }: { children: (companyId: string) => ReactNode }) {
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const router = useRouter();
  const allowed = osAllowed(role);
  const accounts = useApi<{ id: string; name: string }[]>(allowed ? "/gifting-planning/accounts" : null);
  const [chosen, setChosen] = useState("");
  useEffect(() => { try { setChosen(window.localStorage.getItem(KEY) ?? ""); } catch { /* storage unavailable */ } }, []);
  useEffect(() => { if (role && !allowed) router.replace("/dashboard"); }, [role, allowed, router]);
  if (!allowed) return null;

  if (accounts.error && !accounts.data) return <StateView kind="error" message={accounts.error} onRetry={() => void accounts.reload()} />;
  if (!accounts.data) return <TableSkeleton columns={5} />;
  const list = accounts.data;
  const inHeader = picksInHeader(role);
  const picked = inHeader ? pickedClient() : null;
  if (!list.length && !picked) return <StateView kind="empty" title="No client in Gifting OS yet" message="Set a client up in Gifting OS from its page in Client Management." />;
  if (inHeader && picked && !list.some((a) => a.id === picked.id)) {
    return <ClientSetup key={picked.id} companyId={picked.id} name={picked.name} onDone={() => void accounts.reload()} />;
  }
  const one = list.length === 1 ? list[0].id : ALL_CLIENTS;
  const companyId = inHeader ? picked?.id ?? one : list.some((a) => a.id === chosen) ? chosen : one;

  const choose = (id: string) => { setChosen(id); try { window.localStorage.setItem(KEY, id); } catch { /* not remembered */ } };
  return (
    <div className="space-y-4">
      {!inHeader && (
        <FilterMenu icon={<Building2 className="h-4 w-4" />} label="Client" searchable width={300} value={companyId} onChange={(id) => choose(id || ALL_CLIENTS)}
          options={[{ value: ALL_CLIENTS, label: "All clients" }, ...list.map((a) => ({ value: a.id, label: a.name }))]} />
      )}
      {/* A new client starts the page afresh (search, page and open forms). */}
      <div key={companyId} className="space-y-4">{children(companyId)}</div>
    </div>
  );
}
