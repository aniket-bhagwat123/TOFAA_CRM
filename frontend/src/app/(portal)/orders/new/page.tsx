"use client";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { OrderForm } from "@/components/orders/order-form";
import { PageHeader } from "@/components/ui/page-header";
import { useApi } from "@/hooks/use-api";
import { apiClient, errorMessage } from "@/services/api-client";
import type { ClientSummary } from "@/types/crm";
import type { OrderDetail } from "@/types/orders";

/** An order made by hand, for a client order that did not come through a deal. */
export default function NewOrderPage() {
  const router = useRouter();
  const clients = useApi<ClientSummary[]>("/clients"); // a KAM gets their own clients
  const [busy, setBusy] = useState(false);

  async function create(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await apiClient.post<OrderDetail>("/orders", payload);
      toast.success(`${res.data.orderNumber} created`);
      router.push(`/orders/${res.data.id}`);
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="New order" />
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"><ChevronLeft className="h-4 w-4" />All orders</Link>
      <OrderForm clients={clients.data?.map((c) => ({ id: c.id, name: c.name }))} busy={busy} onCancel={() => router.push("/orders")} onSubmit={(p) => void create(p)} />
    </div>
  );
}
