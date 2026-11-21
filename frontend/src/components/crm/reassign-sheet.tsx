"use client";
import { UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { apiClient, errorMessage } from "@/services/api-client";
import type { AssignableUser } from "@/types/crm";
import type { LeadTarget } from "./types";

type Props = { target: LeadTarget | null; currentOwnerId?: string | null; onClose: () => void; onDone: () => void };

export function ReassignSheet({ target, currentOwnerId, onClose, onDone }: Props) {
  const users = useApi<AssignableUser[]>(target ? "/users/assignable" : null);
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  async function save() {
    if (!target) return;
    if (!owner) return setErr("Choose who should own this lead");
    setBusy(true);
    try {
      await apiClient.post(`/leads/${target.leadId}/reassign`, { ownerId: owner });
      toast.success("Lead reassigned");
      setOwner("");
      onClose();
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!target} title="Reassign lead" subtitle={target?.name} icon={UserCog} tone="sky" onClose={onClose}>
      <div className="space-y-4">
        <SelectField
          label="New owner"
          required
          error={err}
          value={owner}
          placeholder="Choose a person"
          options={(users.data ?? []).filter((u) => u.id !== currentOwnerId).map((u) => ({ value: u.id, label: u.fullName ?? u.id }))}
          onChange={(e) => { setOwner(e.target.value); setErr(undefined); }}
        />
        <p className="text-xs text-slate-500">Open tasks and meetings move with the lead. The change is logged.</p>
        <Button onClick={save} loading={busy} className="w-full">Reassign</Button>
      </div>
    </Sheet>
  );
}
