"use client";
import { Megaphone, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AddClientSheet } from "@/components/clients/add-client-sheet";
import { CampaignModal } from "@/components/clients/campaign-modal";
import { ClientCard } from "@/components/clients/client-card";
import { ManageClientSheet } from "@/components/clients/client-small-sheets";
import { ClientTable } from "@/components/clients/client-table";
import { ClientFollowUpSheet, type ClientTaskTarget } from "@/components/clients/followup-sheets";
import { Button } from "@/components/ui/button";
import { ClearFilters, FilterLabel, FilterSelect } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { BoardSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { BOARD_TABLE, ViewToggle } from "@/components/ui/view-toggle";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { openWhatsApp, telHref } from "@/lib/format";
import { canManageClients, isManager } from "@/lib/roles";
import { useAppSelector } from "@/store/hooks";
import type { AssignableUser, ClientSummary } from "@/types/crm";

const VIEW_KEY = "clients.view"; // Board (cards) or Table, remembered in this browser

export default function ClientsPage() {
  const router = useRouter();
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const manager = !!role && isManager(role);
  const canManage = !!role && canManageClients(role);
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [occasions, setOccasions] = useState(""); // "" | "soon" | "none"
  const [calling, setCalling] = useState<ClientTaskTarget | null>(null);
  const [adding, setAdding] = useState(false);
  const [campaign, setCampaign] = useState(false);
  const [assigning, setAssigning] = useState<ClientSummary | null>(null);
  const [layout, setLayout] = useState<"board" | "table">("board");
  const q = useDebounce(search, 300);

  useEffect(() => { try { if (localStorage.getItem(VIEW_KEY) === "table") setLayout("table"); } catch { /* storage unavailable */ } }, []);
  const chooseLayout = (v: "board" | "table") => { setLayout(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };

  const list = useApi<ClientSummary[]>("/clients", { search: q, tier, status, ownerId: owner, occasionSoon: occasions === "soon" || undefined, noOccasions: occasions === "none" || undefined });
  const people = useApi<AssignableUser[]>(manager ? "/users/assignable" : null);
  const filtering = !!(q || tier || status || owner || occasions);
  const activeFilters = [q, tier, status, owner, occasions].filter(Boolean).length;
  const clearAll = () => { setSearch(""); setTier(""); setStatus(""); setOwner(""); setOccasions(""); };
  const shown = list.data?.length;

  // Call dials, and the outcome form is waiting when the call ends, so every client call is recorded.
  const call = (c: ClientSummary) => {
    const phone = c.primaryContact?.phone;
    const href = telHref(phone);
    if (href) window.location.href = href;
    setCalling({ companyId: c.id, companyName: c.name, calling: `${c.primaryContact?.name ?? c.name}${phone ? ` · ${phone}` : ""}` });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader title="Client Management" />
      {/* Row 1: search on the left; view switch, Campaign and Add client on the right */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="min-w-0 flex-1 sm:max-w-sm" value={search} onChange={setSearch} placeholder="Search clients" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ViewToggle value={layout} onChange={chooseLayout} options={BOARD_TABLE} />
          {canManage && <Button variant="secondary" onClick={() => setCampaign(true)}><Megaphone className="h-4 w-4" /><span className="hidden sm:inline">Campaign</span></Button>}
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add client</Button>
        </div>
      </div>

      {/* Row 2: filters (an active one turns blue), Clear, and how many clients are shown */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterLabel />
        <FilterSelect label="Tier" all="All tiers" value={tier} onChange={setTier} options={["A", "B", "C"].map((t) => ({ value: t, label: `Tier ${t}` }))} />
        <FilterSelect label="Status" all="Active and dormant" value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "dormant", label: "Dormant" }]} />
        <FilterSelect label="Occasions" all="All occasions" value={occasions} onChange={setOccasions}
          options={[{ value: "soon", label: "Occasion coming soon" }, { value: "none", label: "No occasions added" }]} />
        {people.data && (
          <FilterSelect label="Owner" all="Whole team" value={owner} onChange={setOwner} options={people.data.map((u) => ({ value: u.id, label: u.fullName ?? "Unnamed" }))} />
        )}
        <ClearFilters count={activeFilters} onClear={clearAll} />
        {shown != null && <span className="t-meta ml-auto whitespace-nowrap">{shown} {shown === 1 ? "client" : "clients"}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.loading && !list.data && (layout === "board" ? <BoardSkeleton /> : <TableSkeleton columns={6} rows={8} />)}
        {list.error && !list.data && <StateView kind="error" message={list.error} onRetry={() => void list.reload()} />}
        {list.data && list.data.length === 0 && (
          <StateView
            kind="empty"
            title={filtering ? "No clients match" : "No clients yet"}
            message={filtering ? "Try a different search or clear the filters." : "A lead becomes a client as soon as its payment is confirmed. You can also add customers you already work with."}
            action={filtering ? undefined : <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add client</Button>}
          />
        )}
        {list.data && list.data.length > 0 && layout === "table" && (
          <ClientTable clients={list.data} showOwner={manager} onAssign={manager ? setAssigning : undefined} onCall={call} onWhatsApp={(c) => openWhatsApp(c.primaryContact?.phone)} />
        )}
        {list.data && list.data.length > 0 && layout === "board" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.map((c) => (
              <ClientCard key={c.id} client={c} showOwner={manager} onAssign={manager ? () => setAssigning(c) : undefined} onCall={() => call(c)} onWhatsApp={() => openWhatsApp(c.primaryContact?.phone)} />
            ))}
          </div>
        )}
      </div>


      <ManageClientSheet client={assigning} onClose={() => setAssigning(null)} onDone={() => void list.reload()} />
      <AddClientSheet open={adding} onClose={() => setAdding(false)} onDone={(id) => router.push(`/clients/${id}`)} />
      <CampaignModal open={campaign} onClose={() => setCampaign(false)} />
      <ClientFollowUpSheet target={calling} onClose={() => setCalling(null)} onDone={(pid) => (pid ? router.push(`/projects/${pid}`) : void list.reload())} />
    </div>
  );
}
