-- Phase 2: deal value and targets, minutes of meeting, quotations, agreement checklist, payments.
-- Safe to run twice. The backend uses the service role; RLS is on with no policies, so direct access is denied.

-- 1. Timeline kinds ---------------------------------------------------------------------------
alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind in
  ('created', 'call', 'whatsapp', 'meeting', 'note', 'stage_change', 'reassign', 'task', 'import',
   'mom', 'quotation', 'agreement', 'payment'));

-- 2. Deal value grows with the deal: estimate -> quotation total -> amount paid ---------------------
alter table public.leads
  add column if not exists estimate_amount numeric(14, 2) check (estimate_amount is null or estimate_amount > 0),
  add column if not exists quote_amount numeric(14, 2) check (quote_amount is null or quote_amount > 0),
  add column if not exists paid_amount numeric(14, 2) check (paid_amount is null or paid_amount > 0),
  add column if not exists closed_at timestamptz;
create index if not exists leads_closed_idx on public.leads (owner_id, closed_at) where closed_at is not null;

-- 3. Monthly target and discount limit per executive ------------------------------------------------
create table if not exists public.executive_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  month date not null,                                           -- first day of the month
  target_amount numeric(14, 2) not null default 0 check (target_amount >= 0),
  discount_limit numeric(5, 2) not null default 0 check (discount_limit between 0 and 100),   -- percent
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

-- 4. Minutes of meeting ------------------------------------------------------------------------------
create table if not exists public.moms (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete set null,
  body text,
  file_path text,
  file_name text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (body is not null or file_path is not null)
);
create index if not exists moms_lead_idx on public.moms (lead_id, created_at desc);

-- 5. Quotations: a template, versions per lead, line items ------------------------------------------------
create table if not exists public.quotation_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  intro text,
  terms text,
  footer text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
insert into public.quotation_templates (name, intro, terms, footer, is_default)
values (
  'Standard quotation',
  'Thank you for your interest. Please find our quotation below.',
  E'1. Prices are in Indian Rupees.\n2. This quotation is valid for the period shown above.\n3. Delivery timelines are confirmed once the agreement is signed.',
  'We look forward to working with you.',
  true
) on conflict (name) do nothing;

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  version integer not null,
  status text not null default 'ready' check (status in ('ready', 'pending_approval', 'approved', 'rejected', 'sent')),
  template_id uuid references public.quotation_templates (id) on delete set null,
  subtotal numeric(14, 2) not null check (subtotal >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  discount_amount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null check (total >= 0),
  valid_days integer not null default 15 check (valid_days between 1 and 365),
  notes text,
  discount_limit numeric(5, 2),                                  -- the limit that applied when it was made
  created_by uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decision_note text,
  decided_at timestamptz,
  sent_at timestamptz,
  sent_via text check (sent_via in ('whatsapp', 'email')),
  pdf_path text,
  created_at timestamptz not null default now(),
  unique (lead_id, version)
);
create index if not exists quotations_lead_idx on public.quotations (lead_id, version desc);
create index if not exists quotations_pending_idx on public.quotations (status) where status = 'pending_approval';

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  position integer not null,
  description text not null,
  quantity numeric(12, 2) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0)
);
create index if not exists quotation_items_q_idx on public.quotation_items (quotation_id, position);

-- 6. Agreement checklist and payments -----------------------------------------------------------------------
create table if not exists public.agreements (
  lead_id uuid primary key references public.leads (id) on delete cascade,
  sent_at timestamptz,
  signed_at timestamptz,
  signed_path text,
  signed_name text,
  invoice_number text,
  invoice_raised_at timestamptz,
  payment_received_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  invoice_number text not null unique,
  amount numeric(14, 2) not null check (amount > 0),             -- what the invoice is for
  amount_paid numeric(14, 2) not null default 0,                 -- what has actually arrived (partial payments add up)
  status text not null default 'requested' check (status in ('requested', 'partial', 'confirmed')),
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null,    -- null when the ERP confirmed it
  source text check (source in ('erp', 'finance'))
);
create index if not exists payment_requests_status_idx on public.payment_requests (status, requested_at desc);

-- 7. Private storage for minutes and signed agreements ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 8. RLS on, grants ---------------------------------------------------------------------------------------------------
alter table public.executive_settings enable row level security;
alter table public.moms enable row level security;
alter table public.quotation_templates enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.agreements enable row level security;
alter table public.payment_requests enable row level security;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
