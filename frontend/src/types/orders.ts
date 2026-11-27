export type OrderStatus = "new" | "ready" | "accepted" | "rejected" | "production" | "quality_check" | "packed" | "dispatched" | "delivered" | "on_hold" | "cancelled";

export type OrderItemDetail = { name: string; description?: string | null };
export type OrderLine = { name: string; quantity: number; unitPrice: number; details: OrderItemDetail[]; photos: string[]; amount: number; gstAmount: number; lineTotal: number };

export type OrderDetail = {
  id: string; orderNumber: string; status: OrderStatus; source: "payment" | "manual";
  createdAt: string; statusUpdatedAt?: string | null; deliveredAt?: string | null; releasedAt?: string | null;
  leadId?: string | null; pipeline?: string | null;
  company: { id?: string | null; name: string; city?: string | null };
  contact?: { name?: string | null; designation?: string | null; phone?: string | null; email?: string | null; photoUrl?: string | null } | null;
  owner?: { id: string; fullName?: string | null } | null;
  expectedDelivery?: string | null; deliveryAddress?: string | null; receiverName?: string | null; receiverPhone?: string | null;
  instructions?: string | null; billingName?: string | null; billingGstin?: string | null; notes?: string | null;
  courier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null; omsReference?: string | null;
  items: OrderLine[]; itemsFrom?: "agreement" | "quotation" | null;
  units: number; subtotal: number; transportation: number; gstRate: number; gstAmount: number; total: number;
  agreedAmount?: number | null; paidAmount: number; balance?: number | null;
  payments: { invoiceNumber: string; amount: number; amountPaid: number; status: string; confirmedAt?: string | null }[];
  history: { fromStatus?: OrderStatus | null; toStatus: OrderStatus; note?: string | null; createdAt: string; actorName?: string | null; by?: { fullName?: string | null } | null }[];
  managed: boolean; moves: OrderStatus[]; missing: string[]; canEditItems: boolean; canEditDelivery: boolean; canDelete: boolean;
};
