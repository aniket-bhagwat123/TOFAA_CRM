import { z } from "zod";
import { EMAIL_MSG, isEmail, isPhone10, PHONE_MSG } from "@/lib/validation";

export const identifierSchema = z.object({
  identifier: z.string().trim().min(5, "Enter your email or mobile number"),
});

export const codeSchema = z.object({ code: z.string().trim().regex(/^\d{4,10}$/, "Enter the code you received") });

const EITHER = "Enter a phone number or an email";

export const leadSchema = z
  .object({
    companyName: z.string().trim().min(1, "Company name is required"),
    contactName: z.string().trim().min(1, "Contact name is required"),
    phone: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || v.replace(/\D/g, "").length >= 7, "Enter a valid phone number"),
    email: z.union([z.literal(""), z.string().trim().refine(isEmail, EMAIL_MSG)]).optional(),
    source: z.string().optional(),
    designation: z.string().optional(),
    city: z.string().optional(),
    valueBand: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.phone && !v.email) {
      // Both fields are marked: either one satisfies the rule.
      ctx.addIssue({ code: "custom", path: ["phone"], message: EITHER });
      ctx.addIssue({ code: "custom", path: ["email"], message: EITHER });
    }
  });

export type LeadValues = z.infer<typeof leadSchema>;
