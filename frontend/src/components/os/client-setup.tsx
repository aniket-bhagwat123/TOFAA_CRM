"use client";
import { Gift } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { apiClient, errorMessage } from "@/services/api-client";
import type { GiftingClient } from "@/types/gifting";

/**
 * Shown for a client that is not in Gifting OS yet: nothing can be saved under it until it is. Offers the set-up right
 * here to those who may do it (the server decides), so they can carry on where they are.
 */
export function ClientSetup({ companyId, name, onDone }: { companyId: string; name: string; onDone: () => void }) {
  const client = useApi<GiftingClient>(`/gifting-clients/${companyId}`);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const canSetUp = !!client.data?.canSetUp;

  async function setUp() {
    setBusy(true);
    try {
      const res = await apiClient.post<GiftingClient>(`/gifting-clients/${companyId}`);
      client.setData(res.data);
      toast.success(`${name} is set up in Gifting OS`);
      setConfirm(false);
      onDone();
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StateView kind="empty" title={`${name} is not set up in Gifting OS`}
        message={!client.data && !client.error ? "Checking what you can do…"
          : canSetUp ? "Set it up to add occasions, events and gift requests for this client."
            : client.error ?? "An admin or a sales manager can set it up. Until then, choose another client."}
        action={
          <>
            {canSetUp && <Button onClick={() => setConfirm(true)}><Gift className="h-4 w-4" />Set up in Gifting OS</Button>}
            <Link href={`/clients/${companyId}`} className="pressable inline-flex min-h-10 items-center rounded-xl border border-slate-300/80 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Open client</Link>
          </>
        } />
      <DeleteDialog open={confirm} title="Set up in Gifting OS?" confirmLabel="Set up" tone="primary" loading={busy}
        message={`This creates ${name} in Gifting OS (or links the client there with the same name) and copies its people and groups.`}
        onConfirm={() => void setUp()} onCancel={() => setConfirm(false)} />
    </>
  );
}
