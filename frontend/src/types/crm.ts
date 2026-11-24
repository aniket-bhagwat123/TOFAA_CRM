export type StageKey =
  | "new_lead" | "connected" | "meeting_scheduled" | "requirement_received"
  | "quotation_sent" | "sampling" | "agreement_payment" | "closed_won" | "closed_lost"
  | "project_follow_up" | "project_meeting" | "project_proposal" | "project_negotiation";

export type Pipeline = "new_business" | "client";

export type StageConfig = { stage: StageKey; label: string; position: number; probability: number };

export type Lead = {
  id: string;
  companyId: string;
  contactId: string;
  ownerId: string | null;
  stage: StageKey;
  pipeline?: Pipeline;
  projectTitle?: string | null;
  occasion?: string | null;
  origin?: "outbound" | "inbound" | "occasion" | "repeat" | "converted" | null;
  source?: string | null;
  valueBand?: string | null;
  notes?: string | null;
  nextFollowUp?: string | null;
  lostReason?: string | null;
  lostFromStage?: StageKey | null; // the stage a lost lead was in when it was lost (lead detail only)
  requirement: Record<string, string | number | null>;
  version: number;
  lastActivityAt: string;
  lastCallOutcome?: string | null; // "What happened?" on the latest logged call
  callAttempts?: number; // calls logged as "Not reachable"
  tags?: string[]; // "nurture" (set by a "Future requirement" call)
  cold?: boolean; // still "Not reachable" after the retry limit
  lastCallAt?: string | null;
  createdAt: string;
  company: { id: string; name: string; kind: "direct" | "os"; city?: string | null };
  dealValue?: number | null;
  valueSource?: string | null;
  contact: { id: string; name: string; designation?: string | null; phone?: string | null; altPhone?: string | null; altName?: string | null; email?: string | null; photoUrl?: string | null };
  owner?: { id: string; fullName?: string | null } | null;
};

export type TaskItem = {
  id: string;
  leadId: string | null;
  companyId?: string | null;
  isClientTask?: boolean;
  pipeline?: Pipeline;
  projectTitle?: string | null;
  kind: string;
  title?: string | null;
  dueDate: string;
  stage: StageKey | null;
  companyName: string;
  contactName: string;
  phone?: string | null;
};

export type MeetingItem = {
  id: string;
  leadId: string;
  startsAt: string;
  kind: "physical" | "online";
  location?: string | null;
  link?: string | null;
  status: "scheduled" | "done" | "cancelled";
  companyName?: string;
  contactName?: string;
  phone?: string | null;
  owner?: { fullName?: string | null };
};

export type NoNextAction = { leadId: string; stage: StageKey; companyName: string; contactName: string; phone?: string | null; pipeline?: Pipeline; projectTitle?: string | null };

export type TodayView = {
  date: string;
  dueToday: TaskItem[];
  overdue: TaskItem[];
  meetings: MeetingItem[];
  noNextAction: NoNextAction[];
  counts: { dueToday: number; overdue: number; meetings: number };
};

export type Activity = {
  id: string;
  kind: "created" | "call" | "whatsapp" | "meeting" | "note" | "stage_change" | "reassign" | "task" | "import" | "mom" | "quotation" | "agreement" | "payment" | "client" | "campaign" | "sample" | "order";
  outcome?: string | null;
  note?: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  actor?: { fullName?: string | null } | null;
};

export type LeadDetail = {
  lead: Lead;
  tasks: { id: string; dueDate: string; title?: string | null; kind: string }[];
  meetings: MeetingItem[];
  timeline: Activity[];
};

export type LeadMeta = {
  stages: StageConfig[];
  sources: string[];
  lostReasons: string[];
  valueBands: string[];
  requiredInputs: Record<string, string[]>;
  rules?: { retry: { maxAttempts: number; gapDays: number }; nurtureDays: number; stuckDays: number };
};

export type DuplicateMatch = {
  leadId: string;
  companyName: string;
  contactName: string;
  stage: StageKey;
  ownerName?: string | null;
  matchedOn: ("phone" | "email" | "company")[];
  canOpen: boolean;
  companyId?: string;
  isClient?: boolean;
  pipeline?: Pipeline;
};

export type AppNotification = { id: string; title: string; body?: string | null; link?: string | null; createdAt: string };
export type AssignableUser = { id: string; fullName: string | null; role: string; managerId?: string | null };

// ---- Phase 2 ----------------------------------------------------------------------------------------------

export type QuotationItem = { id?: string; description: string; quantity: number; unitPrice: number };
/** A photo stored on the server: `path` is what gets saved with the quotation, `url` is a short-lived preview link. */
export type QuotationPhoto = { path: string; url?: string | null };
export type PackageItem = { name: string; description?: string | null };
/** A client requirement inside a quotation: priced as rate per unit x quantity, with its items and mockup photos. */
export type QuotationPackage = { id?: string; name: string; unitPrice: number; quantity: number; items: PackageItem[]; photos: QuotationPhoto[] };
export type QuotationStatus = "ready" | "pending_approval" | "approved" | "rejected" | "sent";
export type Quotation = {
  id: string;
  version: number;
  number: string;
  status: QuotationStatus;
  subtotal: number;
  discountPct: number;
  discountAmount: number;
  total: number;
  validDays: number;
  notes?: string | null;
  discountLimit?: number | null;
  decisionNote?: string | null;
  sentAt?: string | null;
  sentVia?: "whatsapp" | "email" | null;
  createdAt: string;
  author?: { fullName?: string | null } | null;
  items: QuotationItem[]; // older quotations made from flat line items
  packages?: QuotationPackage[];
};
export type Minutes = { id: string; body?: string | null; fileName?: string | null; fileUrl?: string | null; createdAt: string; author?: { fullName?: string | null } | null };
export type PaymentRequest = { id: string; invoiceNumber: string; amount: number; amountPaid: number; status: "requested" | "partial" | "confirmed"; requestedAt: string; confirmedAt?: string | null; source?: "erp" | "finance" | null };
export type AgreementTerm = { title: string; body: string };
export type AgreementTotals = { units: number; base: number; avgRate: number; transportation: number; gstRate: number; gst: number; total: number };
/** The agreement as prepared in the CRM (before it is signed). */
export type AgreementDetails = {
  packages: { name: string; unitPrice: number; quantity: number; items: PackageItem[]; photos: QuotationPhoto[] }[];
  scope: string[]; scopeOther?: string | null; transportation: number; gstRate: number; terms: AgreementTerm[];
  tofaaSignee?: string | null; clientSignee?: string | null; remarks?: string | null; totals?: AgreementTotals;
};
export type AgreementState = {
  details?: AgreementDetails | null; totalAmount?: number | null; preparedAt?: string | null;
  termsStatus?: "standard" | "pending" | "approved" | "rejected"; termsNote?: string | null;
  options?: { scope: { value: string; label: string }[]; gstRates: number[]; defaultTerms: AgreementTerm[] };
  sentAt?: string | null; signedAt?: string | null; signedName?: string | null; signedUrl?: string | null;
  invoiceNumber?: string | null; invoiceRaisedAt?: string | null; paymentReceivedAt?: string | null;
  payment?: PaymentRequest | null;
};
export type DealData = {
  value: { amount: number | null; source: string | null; estimate?: number | null; quoted?: number | null; paid?: number | null };
  minutes: Minutes[];
  discountLimit: number;
  quotations: Quotation[];
  agreement: AgreementState;
  samples?: SamplesState;
};
/** A sample image or file stored on the server: `path` is saved with the item, `url` is a short-lived preview link. */
export type SampleFile = { path: string; name: string; mime?: string | null; url?: string | null };
export type SampleItem = { id?: string; packageName?: string | null; itemName: string; description?: string | null; files: SampleFile[] };
export type SamplesState = {
  items: SampleItem[];
  lastSent: { sentAt: string; channel: "whatsapp" | "email"; itemCount: number; fileCount: number } | null;
  ready?: boolean;
};
export type QuotationTemplate = { id: string; name: string; intro?: string | null; terms?: string | null; footer?: string | null; isDefault: boolean };

export type TargetCardData = {
  month: string; target: number; won: number; gap: number; weighted: number; unweighted: number; shortfall: number;
  healthy: boolean; progress: number; avgDeal: number | null; winRate: number | null; dealsNeeded: number | null; leadsNeeded: number | null;
  suggestion: string; discountLimit: number;
};
export type TargetMember = { userId: string; fullName: string; targetAmount: number; discountLimit: number; setForThisMonth: boolean; won: number };
export type Approval = {
  id: string; leadId: string; number: string; version: number; total: number; discountPct: number; discountLimit?: number | null;
  companyName?: string; contactName?: string; createdAt: string; author?: { fullName?: string | null } | null;
};
export type PaymentRow = PaymentRequest & { leadId: string; companyName?: string; contactName?: string; requestedByName?: string | null };

// ---- Client management ---------------------------------------------------------------------------------------

export type ClientContact = { id: string; name: string; designation?: string | null; phone?: string | null; email?: string | null; photoUrl?: string | null };
export type ClientSummary = {
  id: string;
  name: string;
  city?: string | null;
  kind?: string | null;
  clientSince?: string | null;
  owner?: { id: string; fullName?: string | null } | null;
  primaryContact?: ClientContact | null;
  contactCount: number;
  lifetimeValue: number;
  revenue12m: number;
  lastOrderAt?: string | null;
  wonProjects: number;
  openProjects: number;
  tier: "A" | "B" | "C";
  tierIsManual: boolean;
  status: "active" | "dormant";
  nextOccasion?: { name: string; date: string; daysAway: number } | null;
};
export type ClientOccasion = { id: string; name: string; fromCalendar: boolean; month?: number | null; day?: number | null; leadDays: number; notes?: string | null; nextDate?: string | null; daysAway?: number | null };
export type ClientTask = { id: string; title?: string | null; dueDate: string; campaignId?: string | null; occasionKey?: string | null };
export type ClientDetail = {
  client: ClientSummary;
  contacts: ClientContact[];
  projects: Lead[];
  occasions: ClientOccasion[];
  followups: ClientTask[];
  timeline: Activity[];
};
export type CalendarDate = { id: string; name: string; occursOn: string };
export type Campaign = { id: string; name: string; occasion: string; occursOn?: string | null; createdAt: string; total: number; counts: Record<"pending" | "interested" | "not_now" | "no_answer", number> };

export type FollowUpItem = TaskItem & {
  ownerId?: string | null;
  meeting?: { id: string; startsAt: string; kind: "physical" | "online"; location?: string | null; link?: string | null } | null;
};

export type FollowUpsView = { date: string; overdue: FollowUpItem[]; today: FollowUpItem[]; tomorrow: FollowUpItem[]; thisWeek: FollowUpItem[] };
