-- OMS handover: the CRM hands an approved order to OMS (see backend/OMS_ORDER_API.md). Run after
-- 20261129100000_order_flow.sql. Safe to run twice. Existing orders are filled in at the end; none of them is shown to
-- OMS until a Sales Manager approves its handover.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'items') then
    raise exception 'Apply 20261129100000_order_flow.sql first. Nothing was changed.';
  end if;
end $$;

-- 1. What the KAM prepares ------------------------------------------------------------------------------------------
alter table public.orders add column if not exists handover_status text;        -- null = not started
alter table public.orders add column if not exists advance_percent numeric(5, 2) check (advance_percent between 0 and 100);
alter table public.orders add column if not exists campaign_name text;
alter table public.orders add column if not exists client_type text;
alter table public.orders add column if not exists total_kits integer check (total_kits > 0);
alter table public.orders add column if not exists handover_items jsonb;        -- [{item_ref, product_id, name, description, quantity_per_kit, is_packaging, photos}]
alter table public.orders add column if not exists delivery_locations jsonb;    -- [{location_ref, line, city, state, pincode, contact_name, contact_phone, quantity}]
alter table public.orders add column if not exists design_brief text;
alter table public.orders add column if not exists reference_files jsonb;       -- [{path, name}] in the documents bucket
alter table public.orders add column if not exists logo_files jsonb;            -- [{path, name}]
alter table public.orders add column if not exists sample jsonb;                -- {required, approver_name, approved_on, evidence: {path, name}}

-- 2. Approval and what OMS may read ----------------------------------------------------------------------------------
alter table public.orders add column if not exists handover_submitted_at timestamptz;
alter table public.orders add column if not exists handover_submitted_by uuid references public.profiles (id) on delete set null;
alter table public.orders add column if not exists handover_decided_at timestamptz;
alter table public.orders add column if not exists handover_decided_by uuid references public.profiles (id) on delete set null;
alter table public.orders add column if not exists handover_note text;          -- the manager's reason, or why it was cancelled
alter table public.orders add column if not exists handover_version integer not null default 0;  -- 0 = never approved
alter table public.orders add column if not exists published jsonb;             -- the last approved handover, exactly as OMS reads it
alter table public.orders add column if not exists published_status text;       -- approved | cancelled
alter table public.orders add column if not exists published_at timestamptz;    -- OMS polls on this

-- 3. What OMS sends back ----------------------------------------------------------------------------------------------
alter table public.orders add column if not exists oms_order_number text;       -- TOF-ORD-YYYY-NNNNN (oms_order_id is oms_reference)
alter table public.orders add column if not exists oms_stage text;
alter table public.orders add column if not exists oms_changed_at timestamptz;  -- older updates are ignored
alter table public.orders add column if not exists ops_confirmed_deadline date;
alter table public.orders add column if not exists shipments jsonb;             -- per location: [{location_ref, kits, transporter, tracking_number, dispatched_at, delivered_at}]

alter table public.orders drop constraint if exists orders_handover_status_check;
alter table public.orders add constraint orders_handover_status_check check
  (handover_status in ('draft', 'pending_approval', 'approved', 'rejected', 'cancelled'));
alter table public.orders drop constraint if exists orders_published_status_check;
alter table public.orders add constraint orders_published_status_check check (published_status in ('approved', 'cancelled'));

create index if not exists orders_published_idx on public.orders (published_at, order_number) where published is not null;
create index if not exists orders_handover_status_idx on public.orders (handover_status) where handover_status is not null;

-- 4. Existing orders -------------------------------------------------------------------------------------------------
-- Open orders from deals get a draft handover. Manual orders never go to OMS. Delivered and cancelled orders are left.
-- What is unknown (city, state, pincode, advance percent) stays empty for the KAM to fill in.

-- Items: the contents of each package, per kit. A package without listed contents is one item.
update public.orders o set handover_items = (
  select jsonb_agg(jsonb_build_object(
           'item_ref', 'IT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
           'product_id', null,
           'name', coalesce(c.value ->> 'name', p.value ->> 'name'),
           'description', c.value ->> 'description',
           'quantity_per_kit', 1,
           'is_packaging', false,
           -- the package's photos belong to an item only when the package is that one item
           'photos', case when c.n is null or jsonb_array_length(p.value -> 'details') = 1
                          then coalesce(p.value -> 'photos', '[]'::jsonb) else '[]'::jsonb end
         ) order by p.n, c.n)
  from jsonb_array_elements(o.items) with ordinality as p(value, n)
  left join lateral jsonb_array_elements(
    case when jsonb_typeof(p.value -> 'details') = 'array' then p.value -> 'details' else '[]'::jsonb end
  ) with ordinality as c(value, n) on true
)
where o.source = 'payment' and o.deleted_at is null and o.status not in ('delivered', 'cancelled')
  and o.handover_items is null and jsonb_typeof(o.items) = 'array' and jsonb_array_length(o.items) > 0;

-- Kits: only when the order has exactly one package with a whole quantity.
update public.orders set total_kits = (items -> 0 ->> 'quantity')::numeric::integer
where source = 'payment' and deleted_at is null and status not in ('delivered', 'cancelled') and total_kits is null
  and jsonb_typeof(items) = 'array' and jsonb_array_length(items) = 1
  and (items -> 0 ->> 'quantity')::numeric >= 1 and (items -> 0 ->> 'quantity')::numeric % 1 = 0;

-- Delivery: the one address becomes the first location.
update public.orders set delivery_locations = jsonb_build_array(jsonb_build_object(
  'location_ref', 'LOC-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  'line', delivery_address, 'city', null, 'state', null, 'pincode', null,
  'contact_name', receiver_name, 'contact_phone', receiver_phone, 'quantity', null))
where source = 'payment' and deleted_at is null and status not in ('delivered', 'cancelled') and delivery_locations is null
  and nullif(trim(delivery_address), '') is not null;

update public.orders o set campaign_name = coalesce(nullif(trim(l.occasion), ''), nullif(trim(l.project_title), ''))
from public.leads l
where l.id = o.lead_id and o.source = 'payment' and o.deleted_at is null and o.status not in ('delivered', 'cancelled')
  and o.campaign_name is null;

update public.orders set handover_status = 'draft'
where source = 'payment' and deleted_at is null and status not in ('delivered', 'cancelled') and handover_status is null;

notify pgrst, 'reload schema';
