-- Naming: the CRM record is a Deal (DEAL-YYYY-####), its handover is HO-YYYY-####, and the Order (TOF-ORD-YYYY-#####)
-- is created by OMS. The old ORD- number of an existing record is kept as its Legacy ID. Run after
-- 20261201100000_oms_payment_status.sql. Safe to run twice. Numbers restart each year (India time) and are never reused.

create table if not exists public.record_counters (
  prefix text not null,
  year integer not null,
  last integer not null default 0,
  primary key (prefix, year)
);
alter table public.record_counters enable row level security;   -- no policies: only the backend and these functions
grant all on public.record_counters to service_role;

create or replace function public.next_record_number(p_prefix text, p_at timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_year integer := extract(year from (coalesce(p_at, now()) at time zone 'Asia/Kolkata'));
  v_last integer;
begin
  insert into public.record_counters as c (prefix, year, last) values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update set last = c.last + 1
  returning c.last into v_last;
  return p_prefix || '-' || v_year || '-' || case when v_last < 10000 then lpad(v_last::text, 4, '0') else v_last::text end;
end;
$$;

alter table public.orders add column if not exists deal_number text;
alter table public.orders add column if not exists handover_number text;
alter table public.orders add column if not exists legacy_id text;      -- the ORD- number of a record made before this
create unique index if not exists orders_deal_number_uq on public.orders (deal_number);
create unique index if not exists orders_handover_number_uq on public.orders (handover_number);

-- Existing records, oldest first.
do $$
declare r record;
begin
  for r in select id, order_number, created_at from public.orders where deal_number is null order by created_at, order_number loop
    update public.orders set legacy_id = r.order_number, deal_number = public.next_record_number('DEAL', r.created_at) where id = r.id;
  end loop;
  for r in select id, coalesce(handover_submitted_at, published_at, now()) as at from public.orders
           where handover_number is null and (handover_submitted_at is not null or published is not null)
           order by 2, order_number loop
    update public.orders set handover_number = public.next_record_number('HO', r.at) where id = r.id;
  end loop;
end $$;

-- A handover already published is read by its new number from now on.
update public.orders
set published = (published - 'crm_order_number') || jsonb_build_object('handover_number', handover_number, 'deal_number', deal_number),
    published_at = now()
where published is not null and published ? 'crm_order_number';

-- New records. After the insert, so an insert that turns out to be a duplicate uses no number.
create or replace function public.give_deal_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set deal_number = public.next_record_number('DEAL', new.created_at) where id = new.id and deal_number is null;
  return null;
end;
$$;
drop trigger if exists orders_deal_number on public.orders;
create trigger orders_deal_number after insert on public.orders for each row execute function public.give_deal_number();

-- The handover gets its number the first time it is sent for approval, and keeps it.
create or replace function public.give_handover_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.handover_submitted_at is not null and new.handover_number is null then
    new.handover_number := public.next_record_number('HO', new.handover_submitted_at);
  end if;
  return new;
end;
$$;
drop trigger if exists orders_handover_number on public.orders;
create trigger orders_handover_number before update of handover_submitted_at on public.orders
  for each row execute function public.give_handover_number();

notify pgrst, 'reload schema';
