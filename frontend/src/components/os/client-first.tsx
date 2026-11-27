"use client";
import { Building2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { useApi } from "@/hooks/use-api";

type Client = { id: string; name: string };
const NONE: Client[] = [];

function ClientDialog({ clients, loading, error, onPick, onCancel }: { clients: Client[]; loading: boolean; error: string | null; onPick: (id: string) => void; onCancel: () => void }) {
  const [choice, setChoice] = useState("");
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); cancel.current(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 px-4">
      <div role="dialog" aria-modal="true" aria-labelledby="client-first-title" className="animate-rise w-full max-w-sm rounded-2xl bg-white p-6 shadow-float">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Building2 className="h-5 w-5" /></span>
        <h2 id="client-first-title" className="mt-3 text-lg font-semibold text-slate-900">Which client is this for?</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">You are viewing all clients.</p>
        <SelectField label="Client" required value={choice} placeholder={loading ? "Loading…" : clients.length ? "Choose a client" : "No client available"}
          error={error ?? undefined} options={clients.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => setChoice(e.target.value)} />
        <div className="mt-5 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button type="button" disabled={!choice} onClick={() => onPick(choice)}>Continue</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * For a form that creates or imports: with no single client in view it asks which client first. `active` is whether the
 * form is wanted; `fixed` the client already in view; `accounts` who can be chosen (default: clients linked to Gifting
 * OS). Open the form once `ready`, for `clientId` and offering only `accounts`. Render `dialog`.
 */
export function useClientFirst({ active, fixed, accounts, onCancel }: { active: boolean; fixed?: string | null; accounts?: Client[]; onCancel: () => void }) {
  const linked = useApi<Client[]>(active && !fixed && !accounts ? "/gifting-planning/accounts" : null);
  const list = accounts ?? linked.data ?? NONE;
  const [chosen, setChosen] = useState("");
  useEffect(() => { if (!active) setChosen(""); }, [active]);
  const only = accounts?.length === 1 || (!accounts && linked.data?.length === 1) ? list[0]?.id : undefined;
  const clientId = fixed || chosen || only || undefined;
  const offered = useMemo(() => (clientId ? list.filter((c) => c.id === clientId) : list), [list, clientId]);
  const name = chosen ? list.find((c) => c.id === chosen)?.name : undefined;
  const dialog = !active ? null
    : !clientId ? <ClientDialog clients={list} loading={!accounts && !linked.data && !linked.error} error={linked.data ? null : linked.error} onPick={setChosen} onCancel={onCancel} />
      : name ? createPortal(<p role="status" className="pointer-events-none fixed left-1/2 top-3 z-[75] -translate-x-1/2 whitespace-nowrap rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-float">Client: {name}</p>, document.body)
        : null;
  return { ready: !!clientId, clientId, accounts: offered, dialog };
}
