"use client";
import { Building2, ChevronRight, FolderPlus, Lightbulb, PhoneIncoming } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ProjectSheet, type ProjectMode } from "@/components/clients/project-sheet";
import { Avatar } from "@/components/ui/avatar";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import type { ClientDetail, ClientSummary } from "@/types/crm";

type Props = { open: boolean; onClose: () => void; onCreated: (projectId: string) => void };

/**
 * New project from the Projects screen: pick how it came in and which client, then the usual project form
 * (with that client's contacts and occasions). Projects always belong to a client.
 */
export function NewProjectFlow({ open, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<ProjectMode>("new");
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const q = useDebounce(search, 250);
  const clients = useApi<ClientSummary[]>(open && !clientId ? "/clients" : null, { search: q || undefined });
  const detail = useApi<ClientDetail>(clientId ? `/clients/${clientId}` : null);

  useEffect(() => {
    if (!open) { setSearch(""); setClientId(null); setMode("new"); }
  }, [open]);

  const choice = (m: ProjectMode, Icon: typeof Lightbulb, title: string, hint: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={cn("pressable flex flex-1 items-start gap-3 rounded-2xl border p-3 text-left", mode === m ? "border-brand bg-brand-soft" : "border-slate-200 hover:bg-slate-50")}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", mode === m ? "bg-brand text-white" : "bg-slate-100 text-slate-500")}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0"><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="block text-xs text-slate-500">{hint}</span></span>
    </button>
  );

  const list = clients.data ?? [];
  const c = detail.data;

  return (
    <>
      <Sheet open={open && !clientId} title="New project" subtitle="Pick the client this project is for" icon={FolderPlus} tone="violet" onClose={onClose} width="lg">
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            {choice("new", Lightbulb, "We see an opportunity", "Follow up and pitch")}
            {choice("inbound", PhoneIncoming, "Client asked", "Capture the requirement, send a proposal today")}
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search clients" />
          <div className="max-h-[min(46vh,22rem)] space-y-1.5 overflow-y-auto">
            {clients.loading && !clients.data ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : list.length === 0 ? (
              <div className="space-y-2 py-8 text-center">
                <p className="text-sm text-slate-500">{q ? "No client matches that name." : "No clients yet."}</p>
                <Link href="/clients" onClick={onClose} className="text-sm font-medium text-brand hover:underline">Add a client in Clients</Link>
              </div>
            ) : (
              list.map((cl) => (
                <button key={cl.id} type="button" onClick={() => setClientId(cl.id)} className="pressable flex w-full items-center gap-3 rounded-xl border border-slate-200 p-2.5 text-left hover:border-brand/40 hover:bg-brand-soft/40">
                  <Avatar src={cl.primaryContact?.photoUrl} name={cl.name} size="sm" square />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{cl.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[cl.city, cl.primaryContact?.name, cl.openProjects ? `${cl.openProjects} open project${cl.openProjects === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "Client"}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              ))
            )}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-slate-500"><Building2 className="h-3.5 w-3.5" /> A company becomes a client with its first paid deal, or when added in Clients.</p>
        </div>
      </Sheet>

      {clientId && !c && (
        <Sheet open title="New project" subtitle="Loading the client" icon={FolderPlus} tone="violet" onClose={onClose}>
          <div className="flex justify-center py-10"><Spinner /></div>
        </Sheet>
      )}
      <ProjectSheet
        clientId={open && c ? clientId : null}
        clientName={c?.client.name}
        mode={mode}
        contacts={c?.contacts ?? []}
        occasions={c?.occasions.map((o) => o.name) ?? []}
        onClose={() => (c ? setClientId(null) : onClose())}
        onDone={(pid) => { onClose(); onCreated(pid); }}
      />
    </>
  );
}
