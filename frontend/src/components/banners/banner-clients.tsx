"use client";
import { useState } from "react";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

type Client = { id: string; name: string };
type Props = {
  allowEveryone: boolean; everyone: boolean; onEveryone: (value: boolean) => void;
  chosen: string[]; onChosen: (ids: string[]) => void; known?: Client[]; error?: string;
};

/** Which clients see a banner: every client (admins) or the ones ticked. Only clients set up in Gifting OS are offered. */
export function BannerClients({ allowEveryone, everyone, onEveryone, chosen, onChosen, known = [], error }: Props) {
  const accounts = useApi<Client[]>("/gifting-planning/accounts");
  const [search, setSearch] = useState("");
  // A client already on the banner stays listed (and can be removed) even if it is no longer linked.
  const all = [...(accounts.data ?? []), ...known.filter((k) => accounts.data && !accounts.data.some((a) => a.id === k.id))];
  const shown = all.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (id: string) => onChosen(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id]);

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">Show to<span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span></legend>
      {allowEveryone && (
        <div role="radiogroup" aria-label="Show to" className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
          {([[true, "All clients"], [false, "Selected clients"]] as const).map(([value, label]) => (
            <button key={label} type="button" role="radio" aria-checked={everyone === value} onClick={() => onEveryone(value)}
              className={cn("pressable min-h-10 rounded-xl px-3 text-sm font-semibold", everyone === value ? "border border-brand bg-white text-brand shadow-sm" : "text-slate-700")}>{label}</button>
          ))}
        </div>
      )}
      {!everyone && (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <SearchInput className="sm:w-full" value={search} onChange={setSearch} placeholder="Search clients" />
          {accounts.error && !accounts.data ? <p role="alert" className="text-sm text-red-600">{accounts.error}</p>
            : !accounts.data ? <div className="space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /></div>
              : !shown.length ? <p className="py-2 text-sm text-slate-500">{all.length ? "No client matches." : "No client of yours is set up in Gifting OS yet."}</p>
                : (
                  <ul className="max-h-44 overflow-y-auto">
                    {shown.map((c) => (
                      <li key={c.id}>
                        <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
                          <input type="checkbox" checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 rounded border-slate-300 accent-brand" />{c.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
          <p className="text-xs text-slate-500">{chosen.length} selected</p>
        </div>
      )}
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    </fieldset>
  );
}
