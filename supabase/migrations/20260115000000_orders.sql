-- Orders get their own tables. An order is created automatically when a lead becomes Closed Won (a database
-- trigger, so it happens whichever part of the app closes the deal), and its delivery moves through
-- Production -> Quality check -> Dispatched -> Delivered. Every step change is kept in order_status_history.
-- Existing won deals are copied in, with the delivery step they already had. Safe to run twice.

create sequence if not exists public.order_number_seq;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('ORD-' || lpad(nextval('public.order_number_seq')::text, 5, '0')),
  lead_id uuid not null unique references public.leads (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  quotation_id uuid references public.quotations (id) on delete set null,   -- the quotation that was sent last
  amount numeric(14, 2),                                                   -- what the deal was won for
  status text not null default 'new' check (status in ('new', 'production', 'quality_check', 'dispatched', 'delivered')),
  status_updated_at timestamptz,
  expected_delivery date,
  delivered_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_status_idx on public.orders (status, created_at desc);
create index if not exists orders_company_idx on public.orders (company_id);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists order_status_history_order_idx on public.order_status_history (order_id, created_at desc);

alter table public.orders enable row level security;
alter table public.order_status_history enable row level security;
-- No policies on purpose: only the backend (service role) reads and writes.
grant all on public.orders to service_role;
grant all on public.order_status_history to service_role;
grant usage, select on sequence public.order_number_seq to service_role;

-- A won deal becomes an order -------------------------------------------------------------------------------------
create or replace function public.create_order_for_won_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'closed_won' and (tg_op = 'INSERT' or old.stage is distinct from 'closed_won') then
    insert into public.orders (lead_id, company_id, quotation_id, amount)
    values (
      new.id, new.company_id,
      (select q.id from public.quotations q where q.lead_id = new.id and q.status = 'sent' order by q.version desc limit 1),
      coalesce(new.paid_amount, new.quote_amount, new.estimate_amount)
    )
    on conflict (lead_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_create_order on public.leads;
create trigger leads_create_order after insert or update of stage on public.leads
  for each row execute function public.create_order_for_won_lead();

-- Copy in the deals already won (and the delivery step they had on the lead, if migration 20260114 added it) ------
insert into public.orders (lead_id, company_id, quotation_id, amount, created_at)
select l.id, l.company_id,
       (select q.id from public.quotations q where q.lead_id = l.id and q.status = 'sent' order by q.version desc limit 1),
       coalesce(l.paid_amount, l.quote_amount, l.estimate_amount),
       coalesce(l.closed_at, l.updated_at, now())
from public.leads l
where l.stage = 'closed_won'
on conflict (lead_id) do nothing;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'delivery_status') then
    update public.orders o
    set status = l.delivery_status, status_updated_at = l.delivery_updated_at,
        delivered_at = case when l.delivery_status = 'delivered' then l.delivery_updated_at end
    from public.leads l
    where l.id = o.lead_id and l.delivery_status is not null and o.status = 'new';
  end if;
end $$;
