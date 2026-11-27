/** Gift requests of the KAM's clients, read from TOFAA Gifting OS. KAM and admin. */
export type GiftStatus = "SUBMITTED" | "IN_REVIEW" | "NEEDS_INFO" | "PROPOSAL_READY" | "CONFIRMED" | "IN_PROGRESS" | "DISPATCHED" | "DELIVERED" | "CANCELLED";

export type GiftRequest = {
  id: string; requestCode?: string | null; accountId?: string | null; accountName?: string | null;
  title: string; purpose?: string | null; status: GiftStatus; statusNote?: string | null;
  recipientName?: string | null; recipientMobile?: string | null;
  occasionName?: string | null; occasionDate?: string | null; eventName?: string | null; eventDate?: string | null;
  deliveryDate?: string | null; deliveryAddress?: string | null;
  budgetMode?: "SPECIFIC" | "TOFAA_RECOMMEND"; budgetMin?: number | string | null; budgetMax?: number | string | null; requestedBudget?: number | string | null;
  relationship?: string | null; interests?: string[]; giftPreferences?: string | null; message?: string | null; specialInstructions?: string | null;
  proposal?: { note?: string | null; options: { name: string; description?: string | null; price: number | string; imageUrl?: string | null }[] } | null;
  selectedOptionIndex?: number | null;
  createdByName?: string | null; createdByRole?: string | null; createdByAvatarUrl?: string | null; recipientAvatarUrl?: string | null;
  relationshipContext?: string | null; initiatedVia?: string | null; giftStyle?: string | null; giftPurpose?: string | null;
  createdAt: string; updatedAt: string;
};

export type GiftRequestList = {
  items: GiftRequest[]; total: number; page: number; limit: number;
  counts: { status: GiftStatus; count: number }[];
  accounts: { id: string; name: string }[];
};

export type GiftAction = "start_review" | "request_info" | "publish_proposal" | "reject" | "start_fulfilment" | "send_to_oms" | "dispatch" | "deliver";

export type GiftRequestDetail = {
  actionsEnabled?: boolean;
  pilotOnly?: boolean;
  allowedActions?: GiftAction[];
  request: GiftRequest;
  history: { id: string; fromStatus?: GiftStatus | null; toStatus: GiftStatus; note?: string | null; createdAt: string; actorName?: string | null; actorRole?: string | null }[];
};

export type PlanningOptions = {
  actionsEnabled: boolean;
  occasions: { id: string; name: string; date?: string | null; own: boolean }[];
  events: { id: string; name: string; date?: string | null }[];
};

export type GiftingLogin = { userId: string; email: string; fullName?: string | null; status: string; clientRole?: string | null };
export type GiftingClient = {
  linked: boolean; canSetUp: boolean; canInvite: boolean; actionsEnabled?: boolean; name?: string; status?: string;
  canManage?: boolean; legalName?: string | null; gstin?: string | null; emailDomain?: string | null; logoUrl?: string | null;
  users: GiftingLogin[];
};
