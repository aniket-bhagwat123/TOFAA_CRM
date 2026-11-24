import type { StageKey } from "@/types/crm";

/** What the action sheets need to know about a lead, wherever it is shown. */
export type LeadTarget = {
  leadId: string;
  name: string; // "Company · Contact"
  phone?: string | null;
  altPhone?: string | null; // the second number (the old one, after a "Wrong number" call gave a new one)
  contactName?: string; // who the main number belongs to
  altName?: string | null; // who the second number belongs to
  stage: StageKey;
  pipeline?: "new_business" | "client";
  companyId?: string;
  lastCallOutcome?: string | null; // preselected in the call outcome sheet
  callAttempts?: number;
  taskId?: string; // called from a follow-up card: the outcome finishes that follow-up
};

export type LeadAction = "call" | "whatsapp" | "meeting" | "stage" | "lost" | "reassign" | "complete";
