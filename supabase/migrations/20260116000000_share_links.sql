-- Short links for files shared with clients (quotation PDFs, sample images and files): https://<crm>/s/Ab3xK9q
-- instead of a long Supabase storage URL. The CRM looks the code up and serves the file itself, so the link never
-- shows the storage provider or the folder layout. Links stop working at expires_at. Safe to run twice.

create table if not exists public.share_links (
  code text primary key,                                   -- short random code (8 letters/digits)
  path text not null,                                      -- the file in the private documents bucket
  file_name text not null,                                 -- the name the client sees when downloading
  mime text,
  kind text not null default 'file' check (kind in ('quotation', 'sample', 'file')),
  lead_id uuid references public.leads (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  opened_count integer not null default 0,
  last_opened_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists share_links_lead_idx on public.share_links (lead_id);

alter table public.share_links enable row level security;
-- No policies on purpose: only the backend (service role) reads and writes.
grant all on public.share_links to service_role;
