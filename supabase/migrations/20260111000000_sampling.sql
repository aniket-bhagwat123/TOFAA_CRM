-- Sampling: a new stage between Quotation Sent and Agreement & Payment. For each item of the quotation the
-- executive uploads sample images and files, then sends them to the client (WhatsApp or email, as secure links).
-- Sending the samples is the action that moves the lead to Sampling. Safe to run twice.

-- 1. The stage ------------------------------------------------------------------------------------------------
insert into public.stage_config (stage, label, position, probability, pipeline)
values ('sampling', 'Sampling', 6, 80, 'new_business')
on conflict (stage) do nothing;
update public.stage_config set position = 7 where stage = 'agreement_payment';
update public.stage_config set position = 8 where stage in ('closed_won', 'closed_lost');

-- 2. Timeline entries for samples -------------------------------------------------------------------------------
alter table public.activities drop constraint if exists activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind in
  ('created', 'call', 'whatsapp', 'meeting', 'note', 'stage_change', 'reassign', 'task', 'import',
   'mom', 'quotation', 'agreement', 'payment', 'client', 'campaign', 'sample'));

-- 3. Sample items and their files -------------------------------------------------------------------------------
create table if not exists public.lead_samples (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  position integer not null,
  package_name text,                                   -- the requirement package the item belongs to
  item_name text not null,
  description text,
  files jsonb not null default '[]'::jsonb,            -- [{ "path": "...", "name": "...", "mime": "..." }] in the documents bucket
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lead_samples_lead_idx on public.lead_samples (lead_id, position);

-- Every time the samples go to the client.
create table if not exists public.sample_sends (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'email')),
  item_count integer not null default 0,
  file_count integer not null default 0,
  sent_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz not null default now()
);
create index if not exists sample_sends_lead_idx on public.sample_sends (lead_id, sent_at desc);

alter table public.lead_samples enable row level security;
alter table public.sample_sends enable row level security;
-- No policies on purpose: only the backend (service role) reads and writes.
grant all on public.lead_samples to service_role;
grant all on public.sample_sends to service_role;
