-- People shared with TOFAA Gifting OS. CRM is the master copy of People; Gifting OS reads and saves them through the
-- CRM API (server to server, API key) and keeps a read-only mirror for its gift requests, occasions and budgets.
-- TOFAA CRM DATABASE ONLY. Safe to run twice.

do $$
begin
  if to_regclass('public.leads') is null or to_regclass('public.tenants') is not null then
    raise exception 'This is not the TOFAA CRM database. Nothing was changed.';
  end if;
end $$;

-- 1. A client account can be linked to one Gifting OS tenant (the client organisation there).
alter table public.companies add column if not exists gifting_tenant_id uuid;
create unique index if not exists companies_gifting_tenant_uq on public.companies (gifting_tenant_id) where gifting_tenant_id is not null;

-- 2. Who added the person: the client themselves (in Gifting OS) or the TOFAA team (CRM, or staff in Gifting OS).
alter table public.recipients add column if not exists added_by text not null default 'TOFAA';
alter table public.recipients drop constraint if exists recipients_added_by_ck;
alter table public.recipients add constraint recipients_added_by_ck check (added_by in ('CLIENT', 'TOFAA'));

-- 3. History entries written from Gifting OS have no CRM user: keep the person's name and their Gifting OS role.
alter table public.recipient_audit add column if not exists actor_role text;
alter table public.recipient_audit drop constraint if exists recipient_audit_actor_role_ck;
alter table public.recipient_audit add constraint recipient_audit_actor_role_ck check (actor_role is null or char_length(actor_role) <= 40);

-- 4. changed_at: when anything about a person last changed (their row, addresses, preferences or links). Gifting OS asks
--    "what changed since ..." with it to keep its mirror current. updated_at keeps its own meaning (last edit of details).
alter table public.recipients add column if not exists changed_at timestamptz not null default now();
create index if not exists recipients_changed_idx on public.recipients (changed_at);

create or replace function public.recipients_mark_changed() returns trigger language plpgsql as $$
begin
  new.changed_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists recipients_mark_changed on public.recipients;
create trigger recipients_mark_changed before insert or update on public.recipients
  for each row execute function public.recipients_mark_changed();

create or replace function public.recipient_part_changed() returns trigger language plpgsql as $$
begin
  update public.recipients set changed_at = clock_timestamp()
  where id = case when tg_op = 'DELETE' then old.recipient_id else new.recipient_id end;
  return null;
end;
$$;
drop trigger if exists recipient_addresses_changed on public.recipient_addresses;
create trigger recipient_addresses_changed after insert or update or delete on public.recipient_addresses
  for each row execute function public.recipient_part_changed();
drop trigger if exists recipient_preferences_changed on public.recipient_preferences;
create trigger recipient_preferences_changed after insert or update or delete on public.recipient_preferences
  for each row execute function public.recipient_part_changed();
drop trigger if exists recipient_relationships_changed on public.recipient_relationships;
create trigger recipient_relationships_changed after insert or update or delete on public.recipient_relationships
  for each row execute function public.recipient_part_changed();

notify pgrst, 'reload schema';
