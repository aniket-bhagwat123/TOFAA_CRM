/** People (recipients of a client's gifts) and Dashboard banners. KAM and admin only. */

export type Relationship = "CLIENT" | "EMPLOYEE" | "PARTNER" | "ADVISOR" | "VENDOR" | "FAMILY" | "SPOUSE" | "CHILD" | "PARENT" | "SIBLING" | "FRIEND" | "OTHER";
export type PersonStatus = "ACTIVE" | "ARCHIVED";

export type Completeness = {
  percent: number;
  needsAttention: boolean;
  sections: { key: string; label: string; percent: number; missing: string[] }[];
};

export type Person = {
  id: string;
  companyId: string;
  account: { id: string; name: string | null };
  name: string;
  mobileNumber?: string | null;
  email?: string | null;
  companyName?: string | null;
  designation?: string | null;
  department?: string | null;
  city?: string | null;
  dateOfBirth?: string | null;
  anniversaryDate?: string | null;
  budget?: number | string | null;
  birthdayBudget?: number | string | null;
  anniversaryBudget?: number | string | null;
  giftingOccasion?: string | null;
  remark?: string | null;
  relationship?: Relationship | null;
  recipientType: "INTERNAL" | "EXTERNAL";
  status: PersonStatus;
  isPrimary: boolean;
  version: number;
  source: "MANUAL" | "IMPORT";
  photoUrl?: string | null;
  groups: { id: string; name: string }[];
  nextOccasion?: { kind: "BIRTHDAY" | "ANNIVERSARY"; label: string; date: string; daysAway: number } | null;
  completeness: Completeness;
  createdAt: string;
};

export type PeopleList = { items: Person[]; total: number; page: number; limit: number };
export type PeopleSummary = { total: number; active: number; archived: number; cities: string[]; relationships: Relationship[] };
export type Duplicate = { id: string; name: string; mobileNumber?: string | null; email?: string | null; city?: string | null; status: PersonStatus; reasons: ("SAME_MOBILE" | "SAME_EMAIL" | "SAME_NAME")[] };

export type PersonAddress = {
  id: string; label: "PERMANENT" | "CURRENT" | "OFFICE"; addressLine1: string; addressLine2?: string | null;
  city: string; state?: string | null; postalCode: string; country: string; isDefault: boolean;
};
export type PersonPreferences = {
  interests: string[]; preferredBrands: string[]; giftPreferences?: string | null; dietaryPreferences?: string | null;
  giftsToAvoid?: string | null; specialInstructions?: string | null;
};
export type PersonLink = { id: string; relatedRecipientId: string; relationshipType: string; related?: { id: string; name: string; deletedAt?: string | null } | null };
export type HistoryEntry = { id: number; createdAt: string; actorName?: string | null; action: string; field?: string | null; oldValue?: unknown; newValue?: unknown; source: string };

export type PeopleGroup = { id: string; companyId: string; accountName?: string | null; name: string; recipientIds: string[]; count: number; createdAt: string; updatedAt?: string | null };

export type ImportResult = { total: number; created: number; skipped: { row: number; name: string; reason: string }[]; groups: { name: string; added: number; new: boolean }[] };

export type Banner = {
  id: string; audience: "ALL" | "KAM" | "ADMIN"; title?: string | null; imageUrl?: string | null; sortOrder: number; isActive: boolean;
  startsOn?: string | null; endsOn?: string | null; live?: boolean; createdAt: string;
};
