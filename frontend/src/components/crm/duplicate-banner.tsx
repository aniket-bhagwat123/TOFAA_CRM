import { AlertTriangle, Building2 } from "lucide-react";
import Link from "next/link";
import { STAGE_LABEL } from "@/lib/format";
import type { DuplicateMatch } from "@/types/crm";

/** "This already exists" with the owner, instead of silently creating a duplicate. An existing client is pointed to its card. */
export function DuplicateBanner({ matches, children }: { matches: DuplicateMatch[]; children?: React.ReactNode }) {
  if (!matches.length) return null;
  const client = matches.find((m) => m.isClient);
  return (
    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" /> Already in the CRM
      </div>
      {client && client.companyId && (
        <Link href={`/clients/${client.companyId}`} className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 font-medium text-brand hover:underline">
          <Building2 className="h-4 w-4" /> {client.companyName} is already a client. Open their card to start a new project.
        </Link>
      )}
      <ul className="space-y-1">
        {matches.map((m) => (
          <li key={m.leadId}>
            {m.canOpen ? (
              <Link href={`/leads/${m.leadId}`} className="font-medium underline">{m.companyName}</Link>
            ) : (
              <span className="font-medium">{m.companyName}</span>
            )}{" "}
            · {m.contactName} · {STAGE_LABEL[m.stage]} · owner <b>{m.ownerName ?? "unassigned"}</b>
            <span className="text-amber-700"> (matched on {m.matchedOn.join(", ")})</span>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}
