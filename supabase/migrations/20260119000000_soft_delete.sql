-- Soft delete for leads and clients (companies). A deleted row stays in the database (with who and when) but is hidden
-- everywhere in the app. The app only allows it when nothing is connected (no quotation, agreement, payment, order,
-- sample, minutes or meeting for a lead; no deal or project for a client). Safe to run twice.

alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads add column if not exists deleted_by uuid references public.profiles (id) on delete set null;
alter table public.companies add column if not exists deleted_at timestamptz;
alter table public.companies add column if not exists deleted_by uuid references public.profiles (id) on delete set null;

-- Lists only ever read live rows: keep those lookups fast.
create index if not exists leads_live_owner_idx on public.leads (owner_id, stage) where deleted_at is null;
create index if not exists companies_live_name_idx on public.companies (name_key) where deleted_at is null;
