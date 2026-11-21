"use client";
import { Megaphone, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddClientSheet } from "@/components/clients/add-client-sheet";
import { CampaignModal } from "@/components/clients/campaign-modal";
import { ClientCard } from "@/components/clients/client-card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { openWhatsApp, telHref } from "@/lib/format";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { AssignableUser, ClientSummary } from "@/types/crm";

const select = "h-10 w-full shrink-0 truncate rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 sm:w-36";

export default function ClientsPage() {
  const router = useRouter();
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const manager = !!role && isManager(role);
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [soon, setSoon] = useState(false);
  const [adding, setAdding] = useState(false);
  const [campaign, setCampaign] = useState(false);
  const q = useDebounce(search, 300);

  const list = useApi<ClientSummary[]>("/clients", { search: q, tier, status, ownerId: owner, occasionSoon: soon || undefined });
  const people = useApi<AssignableUser[]>(manager ? "/users/assignable" : null);
  const filtering = !!(q || tier || status || owner || soon);

  const call = (c: ClientSummary) => { const href = telHref(c.primaryContact?.phone); if (href) window.location.href = href; };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader title="Clients" />
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <SearchInput className="lg:w-60 xl:w-72 lg:min-w-0" value={search} onChange={setSearch} placeholder="Search" />
        <select className={select} value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Tier">
          <option value="">All tiers</option>
          {["A", "B", "C"].map((t) => <option key={t} value={t}>Tier {t}</option>)}
        </select>
        <select className={select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Active and dormant</option>
          <option value="active">Active</option>
          <option value="dormant">Dormant</option>
        </select>
        {people.data && (
          <select className={select} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
            <option value="">Whole team</option>
            {people.data.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        )}
        <button type="button" onClick={() => setSoon((s) => !s)} aria-pressed={soon} className={cn("pressable h-10 shrink-0 rounded-xl border px-4 text-sm font-medium", soon ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-300/80 bg-white text-slate-600")}>
          Occasion soon
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {manager && <Button variant="secondary" onClick={() => setCampaign(true)}><Megaphone className="h-4 w-4" /> Campaign</Button>}
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add client</Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {list.loading && !list.data && <div className="flex h-full min-h-[16rem] items-center justify-center"><Spinner /></div>}
        {list.error && !list.data && <StateView kind="error" message={list.error} onRetry={() => void list.reload()} />}
        {list.data && list.data.length === 0 && (
          <StateView
            kind="empty"
            title={filtering ? "No clients match" : "No clients yet"}
            message={filtering ? "Try a different search or clear the filters." : "A lead becomes a client as soon as its payment is confirmed. You can also add customers you already work with."}
            action={filtering ? undefined : <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add client</Button>}
          />
        )}
        {list.data && list.data.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.map((c) => (
              <ClientCard key={c.id} client={c} showOwner={manager} onCall={() => call(c)} onWhatsApp={() => openWhatsApp(c.primaryContact?.phone)} />
            ))}
          </div>
        )}
      </div>

      <AddClientSheet open={adding} onClose={() => setAdding(false)} onDone={(id) => router.push(`/clients/${id}`)} />
      <CampaignModal open={campaign} onClose={() => setCampaign(false)} />
    </div>
  );
}
