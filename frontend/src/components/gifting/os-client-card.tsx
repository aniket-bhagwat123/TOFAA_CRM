"use client";
import { Gift, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { InputField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { apiClient, errorMessage } from "@/services/api-client";
import type { GiftingClient } from "@/types/gifting";

const ROLES = [{ value: "OWNER", label: "Owner" }, { value: "EA", label: "Executive assistant" }, { value: "HR", label: "HR" }];
const EMPTY = { email: "", fullName: "", clientRole: "OWNER" };

/** On a client's page (KAM and admin): its Gifting OS set-up and the people who sign in there. */
export function GiftingOsCard({ companyId }: { companyId: string }) {
  const client = useApi<GiftingClient>(`/gifting-clients/${companyId}`);
  const [confirm, setConfirm] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const data = client.data;

  async function setUp() {
    setBusy(true);
    try {
      const res = await apiClient.post<GiftingClient>(`/gifting-clients/${companyId}`);
      client.setData(res.data);
      toast.success("Set up in Gifting OS");
      setConfirm(false);
      void client.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  async function invite() {
    const email = form.email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email address.");
    setBusy(true);
    try {
      await apiClient.post(`/gifting-clients/${companyId}/users`, { email, fullName: form.fullName.trim() || undefined, clientRole: form.clientRole });
      toast.success(`Invitation sent to ${email}`);
      setInviting(false);
      void client.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Gift className="h-4 w-4 text-indigo-500" /> Gifting OS</h2>
      {client.error && !data ? <p className="text-xs text-red-600">{client.error}</p>
        : !data ? <p className="text-xs text-slate-400">Loading…</p>
          : !data.linked ? (
            <>
              <p className="text-xs text-slate-500">This client is not set up in Gifting OS yet.{data.canSetUp ? "" : " An admin can set it up."}</p>
              {data.canSetUp && <Button variant="secondary" className="w-full" onClick={() => setConfirm(true)}>Set up in Gifting OS</Button>}
            </>
          ) : (
            <>
              <p className="text-xs text-slate-500">Set up as <span className="font-medium text-slate-700">{data.name}</span></p>
              {data.users.length ? (
                <ul className="divide-y divide-slate-100">
                  {data.users.map((u) => (
                    <li key={u.email} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <span className="min-w-0"><span className="block truncate text-slate-800">{u.fullName || u.email}</span><span className="block truncate text-xs text-slate-400">{u.email}</span></span>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] capitalize text-slate-600">{u.status.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-slate-400">No one from this client can sign in yet.</p>}
              {data.canInvite && <Button variant="secondary" className="w-full" onClick={() => { setForm(EMPTY); setError(""); setInviting(true); }}><UserPlus className="h-4 w-4" />Invite user</Button>}
            </>
          )}
      <DeleteDialog open={confirm} title="Set up in Gifting OS?" confirmLabel="Set up" loading={busy}
        message="This creates the client in Gifting OS (or links the one with the same name) and copies its people and groups." onConfirm={() => void setUp()} onCancel={() => setConfirm(false)} />
      <Sheet open={inviting} title="Invite a client user" subtitle="They get an email with a temporary password" icon={UserPlus} tone="indigo" onClose={() => setInviting(false)}>
        <div className="space-y-4">
          <InputField label="Email" required type="email" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setError(""); }} error={error} />
          <InputField label="Full name" maxLength={150} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <SelectField label="Role" value={form.clientRole} onChange={(e) => setForm({ ...form, clientRole: e.target.value })} options={ROLES} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setInviting(false)}>Cancel</Button>
            <Button loading={busy} onClick={() => void invite()}>Send invitation</Button>
          </div>
        </div>
      </Sheet>
    </Card>
  );
}
