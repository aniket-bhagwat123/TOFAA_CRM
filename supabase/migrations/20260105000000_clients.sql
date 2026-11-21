-- Client management: clients, their projects (a second, shorter pipeline), gifting occasions, client follow-ups,
-- and occasion campaigns. A project is stored as a deal (a leads row) with pipeline = 'client', so calls, WhatsApp,
-- meetings, quotations, payments, the timeline and Today all work for projects without a second system.
-- Safe to run twice.

-- 1. Two pipelines --------------------------------------------------------------------------------
alter table public.stage_config add column if not exists pipeline text not null default 'new_business'
  check (pipeline in ('new_business', 'client', 'both'));
update public.stage_config set pipeline = 'both' where stage in ('closed_won', 'closed_lost');
insert into public.stage_config (stage, label, position, probability, pipeline) values
  ('project_follow_up', 'Follow-up', 1, 10, 'client'),
  ('project_meeting', 'Meeting', 2, 30, 'client'),
  ('project_proposal', 'Proposal', 3, 50, 'client'),
  ('project_negotiation', 'Negotiation', 4, 75, 'client')
on conflict (stage) do nothing;

alter table public.leads
  add column if not exists pipeline text not null default 'new_business' check (pipeline in ('new_business', 'client')),
  add column if not exists project_title text,
  add column if not exists occasion text,
  add column if not exists origin text check (origin in ('outbound', 'inbound', 'occasion', 'repeat', 'converted'));
create index if not exists leads_pipeline_idx on public.leads (pipeline, owner_id, stage);

-- 2. The client record lives on the shared company record (PRD principle 7) ---------------------------
alter table public.companies
  add column if not exists client_since timestamptz,
  add column if not exists account_owner_id uuid references public.profiles (id) on delete set null,
  add column if not exists tier_override text check (tier_override in ('A', 'B', 'C'));
create index if not exists companies_client_idx on public.companies (account_owner_id) where client_since is not null;

-- 3. Gifting occasions -------------------------------------------------------------------------------------
-- Festivals move every year, so their dates live in a calendar Admin keeps up to date.
create table if not exists public.occasion_calendar (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  occurs_on date not null,
  unique (name, occurs_on)
);
-- Movable festival dates below should be checked by Admin (Settings > Occasions) before relying on them.
insert into public.occasion_calendar (name, occurs_on) values
  ('Diwali', '2026-11-08'), ('Diwali', '2027-10-29'),
  ('Holi', '2027-03-22'),
  ('Raksha Bandhan', '2027-08-17'),
  ('Christmas', '2026-12-25'), ('Christmas', '2027-12-25'),
  ('New Year', '2027-01-01'), ('New Year', '2028-01-01'),
  ('Republic Day', '2027-01-26'),
  ('Women''s Day', '2027-03-08'),
  ('Independence Day', '2027-08-15')
on conflict (name, occurs_on) do nothing;

-- A client's own occasions: either a festival from the calendar, or a fixed yearly date (company anniversary ...).
create table if not exists public.client_occasions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  from_calendar boolean not null default false,       -- true: dates come from occasion_calendar by name
  month integer check (month between 1 and 12),
  day integer check (day between 1 and 31),
  lead_days integer not null default 45 check (lead_days between 1 and 180),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_calendar or (month is not null and day is not null))
);
create index if not exists client_occasions_company_idx on public.client_occasions (company_id);

-- 4. Occasion campaigns ("call every client before Diwali") ------------------------------------------------------
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  occasion text not null,
  occurs_on date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.campaign_targets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  outcome text not null default 'pending' check (outcome in ('pending', 'interested', 'not_now', 'no_answer')),
  project_id uuid references public.leads (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (campaign_id, company_id)
);

-- 5. Follow-ups and timeline entries can belong to a client (not only to a deal) ----------------------------------
alter table public.tasks alter column lead_id drop not null;
alter table public.tasks
  add column if not exists company_id uuid references public.companies (id) on delete cascade,
  add column if not exists campaign_id uuid references public.campaigns (id) on delete set null,
  add column if not exists occasion_key text;                  -- "<client occasion id>:<date>", so a reminder is made once
alter table public.tasks drop constraint if exists tasks_owner_check;
alter table public.tasks add constraint tasks_owner_check check (lead_id is not null or company_id is not null);
create unique index if not exists tasks_occasion_once on public.tasks (occasion_key) where occasion_key is not null;
create index if not exists tasks_company_idx on public.tasks (company_id) where company_id is not null;

alter table public.activities alter column lead_id drop not null;
alter table public.activities add column if not exists company_id uuid references public.companies (id) on delete cascade;
alter table public.activities drop constraint if exists activities_owner_check;
alter table public.activities add constraint activities_owner_check check (lead_id is not null or company_id is not null);
create index if not exists activities_company_idx on public.activities (company_id, created_at desc) where company_id is not null;
alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind in
  ('created', 'call', 'whatsapp', 'meeting', 'note', 'stage_change', 'reassign', 'task', 'import',
   'mom', 'quotation', 'agreement', 'payment', 'client', 'campaign'));

-- 6. Existing customers: every company that already has a won deal becomes a client --------------------------------
update public.companies c set
  client_since = coalesce(c.client_since, sub.first_won),
  account_owner_id = coalesce(c.account_owner_id, sub.owner_id)
from (
  select company_id, min(coalesce(closed_at, updated_at)) as first_won,
         (array_agg(owner_id order by coalesce(closed_at, updated_at)))[1] as owner_id
  from public.leads where stage = 'closed_won' group by company_id
) sub
where c.id = sub.company_id and c.client_since is null;

-- 7. RLS on, grants -----------------------------------------------------------------------------------------------------
alter table public.occasion_calendar enable row level security;
alter table public.client_occasions enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_targets enable row level security;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
