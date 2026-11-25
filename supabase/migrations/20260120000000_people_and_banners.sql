-- People (recipients of a client's gifts, with groups) and Dashboard banners. Both modules are for KAM and admin only.
-- People belong to a client account (companies): a KAM works with the people of their own accounts, an admin with all.
-- Every table has RLS on with no policies: only the API (service role) reads and writes. Safe to run twice.

-- 1. People -----------------------------------------------------------------------------------------------------------
create table if not exists public.recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  mobile_number text check (mobile_number is null or mobile_number ~ '^\+?[1-9][0-9]{7,14}$'),
  mobile_key text,                                   -- last 10 digits, for duplicate checks
  email text check (email is null or (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  company_name text check (company_name is null or char_length(company_name) <= 200),   -- for external people
  designation text check (designation is null or char_length(designation) <= 120),
  department text check (department is null or char_length(department) <= 120),
  city text check (city is null or char_length(city) <= 100),
  date_of_birth date,
  anniversary_date date,
  budget numeric(12, 2) check (budget is null or budget >= 0),
  birthday_budget numeric(12, 2) check (birthday_budget is null or birthday_budget >= 0),
  anniversary_budget numeric(12, 2) check (anniversary_budget is null or anniversary_budget >= 0),
  gifting_occasion text check (gifting_occasion is null or char_length(gifting_occasion) <= 200),
  remark text check (remark is null or char_length(remark) <= 2000),
  photo_path text,
  relationship text check (relationship is null or relationship in
    ('CLIENT', 'EMPLOYEE', 'PARTNER', 'ADVISOR', 'VENDOR', 'FAMILY', 'SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'FRIEND', 'OTHER')),
  recipient_type text not null default 'INTERNAL' check (recipient_type in ('INTERNAL', 'EXTERNAL')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  is_primary boolean not null default false,
  version integer not null default 1,                -- optimistic locking: a stale save is refused
  source text not null default 'MANUAL' check (source in ('MANUAL', 'IMPORT')),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,                            -- soft delete
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists recipients_company_mobile_uq on public.recipients (company_id, mobile_key) where deleted_at is null and mobile_key is not null;
create index if not exists recipients_company_created_idx on public.recipients (company_id, created_at desc) where deleted_at is null;
create index if not exists recipients_company_status_idx on public.recipients (company_id, status) where deleted_at is null;

-- Delivery addresses: several per person, at most one default
create table if not exists public.recipient_addresses (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.recipients (id) on delete cascade,
  label text not null default 'OFFICE' check (label in ('PERMANENT', 'CURRENT', 'OFFICE')),
  address_line1 text not null check (char_length(address_line1) between 3 and 300),
  address_line2 text check (address_line2 is null or char_length(address_line2) <= 300),
  city text not null check (char_length(city) between 1 and 100),
  state text check (state is null or char_length(state) <= 100),
  postal_code text not null check (postal_code ~ '^[0-9]{6}$'),
  country text not null default 'IN' check (country ~ '^[A-Z]{2}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recipient_addresses_recipient_idx on public.recipient_addresses (recipient_id);
create unique index if not exists recipient_addresses_one_default_uq on public.recipient_addresses (recipient_id) where is_default;

-- Gifting preferences: one row per person
create table if not exists public.recipient_preferences (
  recipient_id uuid primary key references public.recipients (id) on delete cascade,
  interests text[] not null default '{}',
  preferred_brands text[] not null default '{}',
  gift_preferences text check (gift_preferences is null or char_length(gift_preferences) <= 2000),
  dietary_preferences text check (dietary_preferences is null or char_length(dietary_preferences) <= 1000),
  gifts_to_avoid text check (gifts_to_avoid is null or char_length(gifts_to_avoid) <= 1000),
  special_instructions text check (special_instructions is null or char_length(special_instructions) <= 2000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Links between people of the same client (one row per direction)
create table if not exists public.recipient_relationships (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.recipients (id) on delete cascade,
  related_recipient_id uuid not null references public.recipients (id) on delete cascade,
  relationship_type text not null check (relationship_type in
    ('SPOUSE', 'SON', 'DAUGHTER', 'PARENT', 'SIBLING', 'BUSINESS_ASSOCIATE', 'COLLEAGUE', 'OTHER')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (recipient_id <> related_recipient_id),
  unique (recipient_id, related_recipient_id)
);

-- Change history: append only
create table if not exists public.recipient_audit (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  recipient_id uuid not null references public.recipients (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  action text not null check (action in ('CREATE', 'EDIT', 'IMPORT', 'ARCHIVE', 'RESTORE', 'DELETE')),
  field text,
  old_value jsonb,
  new_value jsonb,
  source text not null default 'MANUAL' check (source in ('MANUAL', 'IMPORT'))
);
create index if not exists recipient_audit_recipient_idx on public.recipient_audit (recipient_id, created_at desc);
create or replace function public.recipient_audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'recipient_audit_is_append_only';
end;
$$;
drop trigger if exists recipient_audit_no_change on public.recipient_audit;
create trigger recipient_audit_no_change before update or delete on public.recipient_audit
  for each row execute function public.recipient_audit_append_only();

-- Groups of people (per client), to gift many at once
create table if not exists public.recipient_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists recipient_groups_company_name_uq on public.recipient_groups (company_id, lower(name));
create table if not exists public.recipient_group_members (
  group_id uuid not null references public.recipient_groups (id) on delete cascade,
  recipient_id uuid not null references public.recipients (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, recipient_id)
);
create index if not exists recipient_group_members_recipient_idx on public.recipient_group_members (recipient_id);

-- 2. Banners ----------------------------------------------------------------------------------------------------------
create table if not exists public.dashboard_banners (
  id uuid primary key default gen_random_uuid(),
  audience text not null default 'ALL' check (audience in ('ALL', 'KAM', 'ADMIN')),
  title text check (title is null or char_length(title) <= 120),   -- alt text for the picture
  image_path text not null,
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  is_active boolean not null default true,
  starts_on date,
  ends_on date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboard_banners_dates_ck check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists dashboard_banners_active_idx on public.dashboard_banners (sort_order) where is_active;

-- Private bucket for banner pictures (up to 5 MB); the API hands out signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banners', 'banners', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- 3. Lock down --------------------------------------------------------------------------------------------------------
alter table public.recipients enable row level security;
alter table public.recipient_addresses enable row level security;
alter table public.recipient_preferences enable row level security;
alter table public.recipient_relationships enable row level security;
alter table public.recipient_audit enable row level security;
alter table public.recipient_groups enable row level security;
alter table public.recipient_group_members enable row level security;
alter table public.dashboard_banners enable row level security;
grant all on public.recipients, public.recipient_addresses, public.recipient_preferences, public.recipient_relationships,
  public.recipient_groups, public.recipient_group_members, public.dashboard_banners to service_role;
grant select, insert on public.recipient_audit to service_role;
grant usage, select on sequence public.recipient_audit_id_seq to service_role;

notify pgrst, 'reload schema';
