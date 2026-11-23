-- Quotations are built from requirement packages: each one has its own name, rate per unit, quantity,
-- the gifting items it contains (name + description) and mockup photos. The package is the priced line:
-- amount = unit_price x quantity. Items inside a package are not priced on their own.
-- Older quotations keep their flat quotation_items rows and still read and print as before.

create table if not exists public.quotation_packages (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  position integer not null,
  name text not null,
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  quantity numeric(12, 2) not null check (quantity > 0),
  items jsonb not null default '[]'::jsonb,          -- [{ "name": "...", "description": "..." }]
  photo_paths text[] not null default '{}',          -- files in the private documents bucket
  created_at timestamptz not null default now()
);
create index if not exists quotation_packages_q_idx on public.quotation_packages (quotation_id, position);

alter table public.quotation_packages enable row level security;
-- No policies on purpose: only the backend (service role) reads and writes, like the other quotation tables.

grant all on public.quotation_packages to service_role;
