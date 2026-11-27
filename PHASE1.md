# Phase 1 setup

Built from the Tofaa Sales CRM PRD (Phase 1: weeks 1-3). Stack: Next.js PWA + FastAPI + Supabase.

## First run

1. **Database:** `supabase db push` (or `supabase db reset` locally). The new migration
   `20260102000000_crm_phase1.sql` replaces the old roles with: admin, sales_manager, sales_executive, finance, kam.
   `20261127100000_sales_executive_to_kam.sql` later merges sales_executive into kam.
2. **Supabase Auth, one-time codes:**
   - Email OTP: Authentication > Email Templates > "Magic Link" must include `{{ .Token }}` so the email carries the 6-digit code.
   - Mobile OTP: Authentication > Providers > Phone, with an SMS provider (MSG91, Twilio ...).
3. **Backend:** copy `backend/.env.example` to `backend/.env`, fill the Supabase keys.
4. **First admin:** `cd backend && python -m src.scripts.create_admin "Your Name" --email you@company.com`
5. `start.bat`, open http://localhost:3000, sign in with a code. Add KAMs and managers in Settings > Users.

## What is in Phase 1

| PRD | Where |
|---|---|
| 7.1 OTP login (password optional), forgot/reset, idle logout | `/login`, `/forgot-password`, `/reset-password`, `modules/auth` |
| 7.2 Today screen | `/today`, `modules/tasks` |
| 7.3 Lead creation + duplicate check | `/leads/new`, `modules/leads` |
| 7.4 Pipeline board and list | `/pipeline` |
| 7.5 Call logging and timeline | `components/crm/quick-log-sheet.tsx`, `modules/activities` |
| 7.6 Meetings | `components/crm/meeting-sheet.tsx`, `modules/meetings` |
| 7.7 Notes with voice-to-text | `components/crm/voice-textarea.tsx` |
| 7.8 Reminders, end-of-day check | `modules/notifications`, Today screen |
| 7.9 Excel import | Leads > Import dialog (`components/crm/import-modal.tsx`), `modules/imports`; samples in `frontend/public/samples/` |
| 7.10 WhatsApp (API + click-to-chat) | `modules/whatsapp`, WhatsApp sheet |
| 7.11 Roles, reassign, audit | `core/access.py`, `/team`, `audit_log` |

## Decisions and gaps to know about

- **Auto-advance to Connected** happens on call outcomes Connected and Call back later (a person answered) and on a WhatsApp reply.
  No answer / Wrong number / Not interested do not advance the stage.
- **Closed Won** cannot be set by KAMs or managers (PRD 8.4: only ERP or Finance). Phase 1 lets Admin set it manually.
- **Stage inputs without Phase 2 features:** Requirement Received asks for occasion, quantity, budget and delivery date
  (MOM upload is Phase 2). Quotation Sent asks for the quotation total typed in (generator is Phase 2).
- **Reminders** are in-app (toast, plus a browser notification when the tab is in the background), generated when the app polls
  every minute. True background push with the app closed needs a scheduler and web-push keys: not built yet.
- **Client meeting reminders on WhatsApp:** the "remind client" flag is stored; automatic sending needs that same scheduler.
- **WhatsApp API** talks to Meta's Cloud API directly (set the `WHATSAPP_*` variables, webhook URL `/api/v1/whatsapp/webhook`).
  If your BSP is different, only `modules/whatsapp/service.py` changes.
- **Single session per user** from the blueprint is off by default (`SINGLE_SESSION=false`) so people can use phone and desktop.
- Finance and KAM roles exist but have no screens until Phase 2 / 4.

## Speed

The API is dominated by round trips to Supabase (each one is a network call), so it is built to make as few as possible:

- **One warm connection.** A long-lived HTTP/2 connection to Supabase (`core/supabase.py`), opened at startup and pinged every 30 seconds (`core/warmup.py`). Idle connections used to be dropped after 5 s, so most calls paid a fresh TLS handshake.
- **Parallel reads and writes.** Independent queries run together (`core/parallel.py`): Today, lead card, team, duplicate check, and every write that touches several tables. Audit-trail writes run in the background.
- **Caching** (`core/cache.py`, in memory):
  - profile, team, stage settings, templates: kept 30 s to 5 min, cleared the moment they are edited;
  - what a user sees (Today, leads, board, lead card, team): kept 20 s per user, and cleared by any successful write on the server, so you never read stale data after your own action.
- **Browser:** the last result of every screen is shown instantly on a revisit and refreshed behind it (`hooks/use-api.ts`).
- **Biggest lever not in code:** keep Render and Supabase in the same region (for India, Mumbai / `ap-south-1`). Round trips then take 5-20 ms instead of 400-600 ms.

Caches are per server process. With more than one worker or instance, other people's changes can take up to the TTL (20-30 s) to show.

## Photos (profile and client)

- **Storage:** Supabase Storage, two **private** buckets, `avatars` (profile photos) and `client-images` (client photos), created by `20260103000000_images.sql`. Nothing is public: the backend uploads, and the API returns signed URLs that last an hour (cached, so a list costs at most one signing request).
- **Endpoints:** `PUT/DELETE /users/me/avatar` (yourself), `/users/{id}/avatar` (admin, or a manager for their team), `PUT/DELETE /leads/{id}/photo` (anyone who can see the lead).
- **Rules (checked on the server):** JPEG, PNG or WebP by the file's real bytes (not the browser's claim), 2 MB maximum. The browser shrinks photos to 720 px before upload (`lib/image.ts`).
- **Where in the UI:** Add user (profile photo), Add lead and Edit lead (client photo), Profile (change your own), avatars in the top bar, user table, lead rows and the lead card.
- **Run `supabase db push` before using photos.** Without the migration the upload endpoints return an error.
