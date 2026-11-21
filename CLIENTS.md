# Client management

## Before you use it
Apply `supabase/migrations/20260105000000_clients.sql` (SQL Editor or `supabase db push`; safe to run twice). It:
- adds the client pipeline (Follow-up, Meeting, Proposal, Negotiation, then the shared Won / Lost),
- adds client fields to companies, gifting occasions, an occasion calendar, campaigns,
- lets follow-ups and timeline entries belong to a client, not only to a deal,
- turns every company that already has a won deal into a client (owner: whoever won it).

Then check **Settings > Occasions**: the seeded festival dates (Diwali, Holi, Raksha Bandhan ...) move every year and should be confirmed.

## How it works
| Situation | What to do | What happens |
|---|---|---|
| A deal is paid | Nothing | Finance or the ERP confirms the payment, the company becomes a client owned by the closing executive, the deal is listed as their first order, and the owner is reminded to add occasions. |
| Existing customer | Clients > Add client | Creates (or converts) the company as a client. |
| New opportunity | Client card > New project | A project at Follow-up, first follow-up next business day. |
| Client calls with a need | Client card > Requirement | Project with quantity, budget, delivery date; "Send the proposal" task due today. |
| Same as last time | Client card > Repeat order | New project with the last order's items already in a quotation, ready to send. |
| Occasion coming | Nothing (add occasions once) | 45 days before each occasion (per occasion, changeable), an "ask about gifting" call appears on the owner's Today screen. "Interested" turns it into a project in the same step. |
| Call everyone before Diwali | Clients > Campaign (managers) | Every client with Diwali as an occasion or a past Diwali project gets a call on their owner's Today screen; progress (interested / not now / no answer) shows in the campaign. |

Projects use the same actions as leads: a meeting moves a project to Meeting, a sent quotation to Proposal, a revised quotation or a discount request to Negotiation, and a confirmed payment to Won. The Pipeline screen has a **Client projects** switch.

## Settings (`backend/.env`)
`CLIENT_TIER_A=1000000`, `CLIENT_TIER_B=200000` (rupees won in the last 12 months; managers can override a tier), `CLIENT_DORMANT_DAYS=180` (no order and nothing open).

## Decisions taken (change if needed)
- Won means paid, as for leads, so targets only count real money.
- The executive who closes the first deal owns the client; managers can move it (open projects and follow-ups move too).
- Reminders are created when the owner opens the app (no background job yet), so a reminder for someone who does not log in waits for them.
- WhatsApp from a client card opens WhatsApp directly; messages about a project are logged from the project.
- Client import from Excel is not built yet: existing customers are converted from their won deals by the migration, or added by hand.
