/** Home, Gift Calendar, Gift Ideas, Events and Activity, read from TOFAA Gifting OS (its own field names). */
/** Whose row it is, when "All clients" is shown. */
type Of = { accountId?: string; accountName?: string };
type Paged<T> = { items: T[]; pagination: { page: number; limit: number; total_records?: number; totalRecords?: number }; actionsEnabled?: boolean };

export type CalendarDay = Of & { eventId?: string | null; occasionId?: string | null; key: string; date: string; title: string; label: string; kind: string; category: "EXTERNAL" | "INTERNAL" | "COMPANY" | "OTHER"; recipientId?: string | null };
export type PersonCard = Of & { recipientId: string; name: string; avatarUrl?: string | null; designation?: string | null; kind?: string; label: string; date: string; daysAway: number };
export type ActivityEntry = Of & { id: string; title: string; description: string; category: string; actorName: string; changedAt: string };
export type OsHome = {
  calendar: { month: string; items: CalendarDay[]; counts: Record<string, number> };
  summary: { importantExternal: PersonCard[]; importantInternal: PersonCard[]; actionRequired: { total: number; items: { key: string; kind?: string; title: string; description: string; requestId?: string | null; recipientId?: string | null }[] } };
  activity: ActivityEntry[];
};

export type OccasionKind = "BIRTHDAY" | "ANNIVERSARY" | "WORK_ANNIVERSARY" | "EVENT" | "FESTIVAL" | "COMPANY_EVENT";
export type PlanStatus = "NOT_PLANNED" | "BUDGET_ALLOCATED" | "REQUEST_SUBMITTED" | "AWAITING_APPROVAL" | "IN_PROGRESS" | "DELIVERED";
export type Priority = "NORMAL" | "HIGH" | "VIP";
/** One date on the Gift Calendar. `status` is known only for the next 90 days; other dates carry just the basics. */
export type OverviewItem = Of & {
  key: string; sourceType: "RECIPIENT" | "COMPANY"; kind: OccasionKind; label: string; name: string; date: string; daysAway: number;
  status?: PlanStatus; tab?: string; priority?: Priority; repeatAnnually?: boolean; sourceDate?: string | null; notes?: string | null; description?: string | null;
  recipientId?: string | null; recipientAvatarUrl?: string | null; relationship?: string | null; eventId?: string | null; occasionId?: string | null;
  isGlobal: boolean; budget?: number | null; requestId?: string | null; requests?: { id: string; requestCode?: string | null; status: string }[];
};
export type OsCalendar = { items: OverviewItem[]; counts: Record<string, number>; pagination: Paged<never>["pagination"]; actionsEnabled: boolean };

export type Occasion = Of & { id: string; tenantId?: string | null; occasionName: string; occasionDate?: string | null; description?: string | null; repeatAnnually: boolean; isActive: boolean; category?: string | null; priority?: Priority; notes?: string | null };
export type OsEvent = Of & { id: string; recipientId?: string | null; recipientName?: string | null; eventName: string; eventDate: string; description?: string | null; repeatAnnually: boolean; isActive: boolean };
export type GiftIdea = { id: string; occasion: string; giftIdea: string; category?: string | null; giftTo: string[]; startDate?: string | null; endDate?: string | null; dateLabel?: string | null; isActive: boolean };

export type Occasions = Paged<Occasion>;
export type Events = Paged<OsEvent>;
export type Ideas = Paged<GiftIdea>;
export type ActivityList = Paged<ActivityEntry>;
