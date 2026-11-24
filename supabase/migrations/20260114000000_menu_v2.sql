-- Menu v2: Dashboard, Quotations, Orders, Approvals, Reports and more Settings. Safe to run twice.

-- 1. Editable settings (retry rules, Nurture days, stuck days, lost reasons, lead sources) -----------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
grant all on public.app_settings to service_role;

-- 2. Orders: a won deal's delivery progress ----------------------------------------------------------------------
alter table public.leads add column if not exists delivery_status text
  check (delivery_status in ('production', 'quality_check', 'dispatched', 'delivered'));
alter table public.leads add column if not exists delivery_updated_at timestamptz;

-- 3. Approvals: an executive's agreement with changed or extra terms waits for a manager ---------------------------
alter table public.agreements add column if not exists terms_status text not null default 'standard'
  check (terms_status in ('standard', 'pending', 'approved', 'rejected'));
alter table public.agreements add column if not exists terms_decided_by uuid references public.profiles (id) on delete set null;
alter table public.agreements add column if not exists terms_decided_at timestamptz;
alter table public.agreements add column if not exists terms_note text;

-- 4. Timeline entries for order progress ------------------------------------------------------------------------------
alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind in
  ('created', 'call', 'whatsapp', 'meeting', 'note', 'stage_change', 'reassign', 'task', 'import',
   'mom', 'quotation', 'agreement', 'payment', 'client', 'campaign', 'sample', 'order'));
