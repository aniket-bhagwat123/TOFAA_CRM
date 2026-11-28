export type OrderStatus = "new" | "ready" | "accepted" | "rejected" | "production" | "quality_check" | "packed" | "dispatched" | "delivered" | "on_hold" | "cancelled";

export type OrderItemDetail = {
  name: string; description?: string | null;
  // only when the items are priced one by one
  unitPrice?: number | null; quantity?: number; amount?: number; gstAmount?: number; lineTotal?: number;
};
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
  managed: boolean; handover?: boolean; handoverStatus?: HandoverStatus | null;
  handoverNumber?: string | null; omsOrderNumber?: string | null; legacyId?: string | null; paymentStatus?: "pending" | "success"; moves: OrderStatus[]; missing: string[]; canEditItems: boolean; canEditDelivery: boolean; canDelete: boolean;
};

// --- OMS handover ----------------------------------------------------------------------------------------------------
export type HandoverStatus = "draft" | "pending_approval" | "approved" | "rejected" | "cancelled";
export type HandoverFile = { path: string; name: string };
export type HandoverItem = { itemRef?: string | null; productId?: string | null; name?: string | null; description?: string | null; quantityPerKit?: number | null; isPackaging: boolean; photos: string[] };
export type HandoverLocation = { locationRef?: string | null; line?: string | null; city?: string | null; state?: string | null; pincode?: string | null; contactName?: string | null; contactPhone?: string | null; quantity?: number | null };
export type HandoverForm = {
  clientType?: string | null; campaignName?: string | null; totalKits?: number | null; expectedDelivery?: string | null;
  advancePercent?: number | null; designBrief?: string | null; referenceFiles: HandoverFile[]; logoFiles: HandoverFile[];
  sample: { required?: boolean | null; approverName?: string | null; approvedOn?: string | null; evidence?: HandoverFile | null };
  items: HandoverItem[]; deliveryLocations: HandoverLocation[]; instructions?: string | null;
};
export type Handover = {
  orderId: string; orderNumber: string; handoverNumber?: string | null; applies: boolean; status: HandoverStatus | null; version: number;
  publishedStatus?: "approved" | "cancelled" | null; publishedAt?: string | null; submittedAt?: string | null; decidedAt?: string | null; note?: string | null;
  companyName?: string | null; ownerName?: string | null; problems: string[];
  canEdit: boolean; canSubmit: boolean; canDecide: boolean; canCancel: boolean;
  form: HandoverForm; fileUrls: { path: string; url: string }[];
  oms: {
    orderId?: string | null; orderNumber?: string | null; stage?: string | null; changedAt?: string | null; confirmedDeadline?: string | null;
    shipments: { locationRef: string; kits?: number | null; transporter?: string | null; trackingNumber?: string | null; dispatchedAt?: string | null; deliveredAt?: string | null }[];
  };
};
