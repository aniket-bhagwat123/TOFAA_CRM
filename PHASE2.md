# Phase 2 setup

Built from PRD section 8: deal value and targets, minutes of meeting, quotation generator, agreement checklist, ERP payment.

## Before you use it
1. **Apply the migration** `supabase/migrations/20260104000000_phase2.sql` (SQL Editor, or `supabase db push`). It adds the deal-value columns,
   targets, minutes, quotations, agreements and payment tables, a default quotation template, and the private `documents` storage bucket.
   Safe to run twice. Until it is applied, the new screens show a "not set up yet" message.
2. **Server settings** (`backend/.env`, see `.env.example`): `COMPANY_NAME` and `COMPANY_ADDRESS` (printed on quotations),
   `ERP_WEBHOOK_SECRET` (shared with the ERP team), `PAYMENT_FALLBACK_ENABLED` (true until the ERP is live).
   Email needs `RESEND_API_KEY` and `RESEND_FROM_EMAIL`; without them, quotations go by WhatsApp only.
3. **Set targets and discount limits:** Team > Targets. A new executive has a 0% discount limit until you set one.

## The flow
| Step | Where | What it does |
|---|---|---|
| Minutes | Lead card > Add minutes (or drag to Requirement Received) | Saves the minutes (typed or a file), the occasion, quantity, budget and delivery date, and moves the lead to Requirement Received. The budget becomes the deal's estimate. |
| Quotation | Lead card > New quotation (or drag to Quotation Sent) | Line items, discount, validity, notes. Within the executive's limit it is ready to send; above it, it waits for the manager (Team > Discounts waiting). Managers and admins can quote any discount. |
| Send | Quotation > Send | WhatsApp (message with a 7-day link to the PDF) or email (PDF attached). Sending moves the lead to Quotation Sent, sets the quotation total as the deal value, and asks for the next follow-up. Each change is a new version (v1, v2 ...). |
| Agreement | Lead card > Agreement and payment | Mark as sent, upload the signed file (moves the lead to Agreement and Payment). |
| Payment | Lead card > Payment requested | The executive enters the invoice number and amount. Finance is notified. |
| Confirm | Payments screen (Finance, Admin) | Finance records what has arrived. The full amount closes the deal as Won; less is a partial payment. The ERP does the same through the callback below. |

**Closed Won** can now only come from a confirmed payment. Nobody can set it by hand, not even an admin.

## ERP callback (assumed contract, confirm with the ERP team)
`POST /api/v1/payments/erp-webhook` with header `X-ERP-Signature: sha256=<hex HMAC-SHA256 of the raw body using ERP_WEBHOOK_SECRET>` and body
`{"invoiceNumber": "INV-123", "status": "paid" | "partial", "amountPaid": 12345.50}`
where `amountPaid` is the total received so far. Matched by invoice number, safe to send twice. With no secret configured every call is refused.
Field names, authentication and how partial payments are shown are guesses until the ERP details in PRD 8.4 are confirmed: only `modules/payments/service.py` (`handle_erp`) changes.
Once the ERP is live, set `PAYMENT_FALLBACK_ENABLED=false` to remove Finance's Confirm button.

## Decisions and gaps
- **No GST/tax line** on quotations (the PRD does not mention it). Easy to add if you invoice with tax shown.
- **Quotation PDF** uses standard PDF fonts: the rupee sign prints as "Rs." and non-Latin text (for example Hindi) is not supported. Check the layout against your real quotation.
- **WhatsApp API mode:** a quotation is sent as free text inside the 24-hour window; outside it, a click-to-chat link is used (templates cannot carry the PDF link yet).
- **Value:** the best figure wins: amount paid, then quotation total, then estimate, then the middle of the rough band.
- **Target card:** "won" counts deals closed this month by their owner, using the amount actually paid. Suggestions use the executive's own average deal and win rate, and say so honestly when there is no history yet.
