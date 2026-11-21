import type { StageKey } from "@/types/crm";

/** What the action sheets need to know about a lead, wherever it is shown. */
export type LeadTarget = {
  leadId: string;
  name: string; // "Company · Contact"
  phone?: string | null;
  stage: StageKey;
  pipeline?: "new_business" | "client";
  companyId?: string;
};

export type LeadAction = "call" | "whatsapp" | "meeting" | "stage" | "lost" | "reassign" | "complete";
