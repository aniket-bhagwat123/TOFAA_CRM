-- Order management: each order keeps its own copy of the items and money, delivery and shipment details, more stages
-- (shared with the order management system, OMS), manual orders, and soft delete. Run after 20260115000000_orders.sql.
-- Safe to run twice. Existing orders and the existing "closed won -> order" trigger keep working.

alter table public.orders alter column lead_id drop not null;   -- an order can be made by hand, without a deal

alter table public.orders add column if not exists source text not null default 'payment' check (source in ('payment', 'manual'));
alter table public.orders add column if not exists owner_id uuid references public.profiles (id) on delete set null;
alter table public.orders add column if not exists items jsonb;               -- [{name, details:[..], photos:[..], quantity, unitPrice}]
alter table public.orders add column if not exists transportation numeric(14, 2) not null default 0 check (transportation >= 0);
alter table public.orders add column if not exists gst_rate numeric(5, 2) not null default 18 check (gst_rate between 0 and 100);
alter table public.orders add column if not exists subtotal numeric(14, 2);
alter table public.orders add column if not exists gst_amount numeric(14, 2);
alter table public.orders add column if not exists total numeric(14, 2);
alter table public.orders add column if not exists delivery_address text;
alter table public.orders add column if not exists receiver_name text;
alter table public.orders add column if not exists receiver_phone text;
alter table public.orders add column if not exists instructions text;          -- branding, packaging, special requests
alter table public.orders add column if not exists billing_name text;
alter table public.orders add column if not exists billing_gstin text;
alter table public.orders add column if not exists released_at timestamptz;    -- when OMS was allowed to see it
alter table public.orders add column if not exists held_from text;             -- the stage to resume after "on hold"
alter table public.orders add column if not exists oms_reference text;
alter table public.orders add column if not exists courier text;
alter table public.orders add column if not exists tracking_number text;
alter table public.orders add column if not exists tracking_url text;
alter table public.orders add column if not exists deleted_at timestamptz;
alter table public.orders add column if not exists deleted_by uuid references public.profiles (id) on delete set null;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in
  ('new', 'ready', 'accepted', 'rejected', 'production', 'quality_check', 'packed', 'dispatched', 'delivered', 'on_hold', 'cancelled'));

alter table public.order_status_history add column if not exists actor_name text;   -- who, when it is not a CRM user (OMS)

create index if not exists orders_updated_idx on public.orders (updated_at desc);
create index if not exists orders_owner_idx on public.orders (owner_id);

-- Existing orders: the deal's owner looks after them.
update public.orders o set owner_id = l.owner_id from public.leads l where l.id = o.lead_id and o.owner_id is null and l.owner_id is not null;

-- New orders from won deals get the owner too (the items are copied by the app).
create or replace function public.create_order_for_won_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'closed_won' and (tg_op = 'INSERT' or old.stage is distinct from 'closed_won') then
    insert into public.orders (lead_id, company_id, quotation_id, amount, owner_id)
    values (
      new.id, new.company_id,
      (select q.id from public.quotations q where q.lead_id = new.id and q.status = 'sent' order by q.version desc limit 1),
      coalesce(new.paid_amount, new.quote_amount, new.estimate_amount), new.owner_id
    )
    on conflict (lead_id) do nothing;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
