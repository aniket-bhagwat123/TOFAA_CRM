-- Phase 1 CRM schema: CRM roles, companies/contacts/leads, tasks, activities, meetings,
-- WhatsApp, notifications, stage config. The backend uses the service role and enforces
-- access in services; RLS is enabled with no policies on the new tables so direct access is denied.

-- 1. Roles -----------------------------------------------------------------------------------
create type public.user_role_v2 as enum ('admin', 'sales_manager', 'sales_executive', 'finance', 'kam');

alter table public.profiles alter column role drop default;
alter table public.profiles
  alter column role type public.user_role_v2
  using (case role::text
           when 'superadmin' then 'admin'
           when 'admin' then 'admin'
           else 'sales_executive'
         end)::public.user_role_v2;
alter table public.profiles alter column role set default 'sales_executive';
drop type public.user_role;
alter type public.user_role_v2 rename to user_role;

create or replace function public.is_superadmin() returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

alter table public.profiles
  add column phone text unique,
  add column manager_id uuid references public.profiles (id) on delete set null;
create index profiles_manager_idx on public.profiles (manager_id);

-- 2. Stage config (editable probabilities) -----------------------------------------------------
create table public.stage_config (
  stage text primary key,
  label text not null,
  position integer not null,
  probability integer not null check (probability between 0 and 100)
);
insert into public.stage_config (stage, label, position, probability) values
  ('new_lead', 'New Lead', 1, 10),
  ('connected', 'Connected', 2, 20),
  ('meeting_scheduled', 'Meeting Scheduled', 3, 30),
  ('requirement_received', 'Requirement Received', 4, 50),
  ('quotation_sent', 'Quotation Sent', 5, 70),
  ('agreement_payment', 'Agreement and Payment', 6, 90),
  ('closed_won', 'Closed Won', 7, 100),
  ('closed_lost', 'Closed Lost', 7, 0);

-- 3. Companies, contacts, leads ----------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text not null,                       -- lowercase alphanumerics, for duplicate checks
  kind text not null default 'direct' check (kind in ('direct', 'os')),
  city text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index companies_name_key_idx on public.companies (name_key);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  designation text,
  phone text,
  phone_key text,                               -- last 10 digits
  email text,
  email_key text,                               -- lowercase email
  created_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);
create index contacts_phone_key_idx on public.contacts (phone_key);
create index contacts_email_key_idx on public.contacts (email_key);
create index contacts_company_idx on public.contacts (company_id);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  contact_id uuid not null references public.contacts (id) on delete restrict,
  owner_id uuid references public.profiles (id) on delete set null,
  stage text not null default 'new_lead' references public.stage_config (stage),
  source text,
  value_band text check (value_band in ('under_1l', '1_5l', '5_20l', '20l_plus')),
  notes text,
  next_follow_up date,
  lost_reason text,
  requirement jsonb not null default '{}',
  version integer not null default 1,
  last_activity_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_owner_idx on public.leads (owner_id, stage);
create index leads_follow_up_idx on public.leads (next_follow_up);
create index leads_company_idx on public.leads (company_id);

-- 4. Tasks (every next action is a dated task) -------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  kind text not null default 'follow_up' check (kind in ('follow_up', 'call', 'whatsapp', 'meeting', 'other')),
  title text,
  due_date date not null,
  done_at timestamptz,
  outcome text,
  created_at timestamptz not null default now()
);
create index tasks_owner_open_idx on public.tasks (owner_id, due_date) where done_at is null;
create index tasks_lead_idx on public.tasks (lead_id);

-- 5. Activity timeline ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in
    ('created', 'call', 'whatsapp', 'meeting', 'note', 'stage_change', 'reassign', 'task', 'import')),
  outcome text,
  note text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activities_lead_idx on public.activities (lead_id, created_at desc);

-- 6. Meetings ----------------------------------------------------------------------------------------
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  starts_at timestamptz not null,
  kind text not null check (kind in ('physical', 'online')),
  location text,
  link text,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled')),
  remind_client boolean not null default false,
  created_at timestamptz not null default now()
);
create index meetings_owner_idx on public.meetings (owner_id, starts_at);
create index meetings_lead_idx on public.meetings (lead_id);

-- 7. WhatsApp ----------------------------------------------------------------------------------------
create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete set null,
  company_id uuid references public.companies (id) on delete set null,   -- history stays with the company
  direction text not null check (direction in ('in', 'out')),
  mode text not null check (mode in ('api', 'click_to_chat')),
  phone text,
  body text not null,
  template text,
  status text not null default 'sent',
  provider_id text,
  sent_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index wa_lead_idx on public.whatsapp_messages (lead_id, created_at desc);
create index wa_phone_idx on public.whatsapp_messages (phone);

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  purpose text not null check (purpose in ('first_contact', 'meeting_reminder', 'follow_up', 'quotation_sent', 'payment_reminder', 'other')),
  body text not null,
  approved boolean not null default false,      -- set true once Meta approves it
  created_at timestamptz not null default now()
);

-- 8. In-app notifications -------------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text,
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- 9. RLS on + grants ---------------------------------------------------------------------------------------
alter table public.stage_config enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.leads enable row level security;
alter table public.tasks enable row level security;
alter table public.activities enable row level security;
alter table public.meetings enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_templates enable row level security;
alter table public.notifications enable row level security;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
