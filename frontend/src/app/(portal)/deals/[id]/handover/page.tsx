"use client";
/** The OMS handover of an order, filled in on its own page. */
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HandoverForm } from "@/components/orders/handover-form";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { setCrumb } from "@/lib/crumb";
import { apiClient, errorMessage, loadErrorMessage } from "@/services/api-client";
import type { Handover, HandoverForm as Values } from "@/types/orders";

export default function HandoverPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [handover, setHandover] = useState<Handover | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const order = `/deals/${id}`;

  // Always read fresh: the form starts from what is saved now, never from a cached copy.
  useEffect(() => {
    let live = true;
    setError("");
    apiClient.get<Handover>(`/orders/by-id/${id}/handover`)
      .then((res) => { if (live) setHandover(res.data); })
      .catch((e) => { if (live) setError(loadErrorMessage(e)); });
    return () => { live = false; };
  }, [id, attempt]);

  // Breadcrumb in the top bar: Deals > Company > Handover.
  const company = handover?.companyName;
  useEffect(() => {
    if (!company) return;
    setCrumb({ path: `/deals/${id}/handover`, parent: { href: "/deals", label: "Deals" }, middle: { href: `/deals/${id}`, label: company }, label: "Handover" });
    return () => setCrumb(null);
  }, [id, company]);

  async function save(values: Values) {
    setSaving(true);
    try {
      await apiClient.put(`/orders/by-id/${id}/handover`, values);
      toast.success("Handover saved");
      router.push(order);
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
      setSaving(false);
    }
  }

  if (error) return <StateView kind="error" message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!handover) return <TableSkeleton columns={4} rows={6} avatar={false} />;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Handover {handover.handoverNumber ?? ""} · {handover.orderNumber}</h1>
        <p className="text-sm text-slate-500">{handover.companyName}. Fields marked <span className="font-semibold text-red-600">*</span> are mandatory.{handover.publishedStatus === "approved" ? " Saving a change needs approval again." : ""}</p>
      </div>
      {handover.canEdit
        ? <HandoverForm handover={handover} busy={saving} onCancel={() => router.push(order)} onSubmit={(v) => void save(v)} />
        : <StateView kind="empty" title="This handover can't be changed" message="The deal is delivered or cancelled, or it does not go to OMS." />}
    </div>
  );
}
