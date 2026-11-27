-- Which clients a banner is shown to. Empty = every client (so every existing banner stays visible to all).
-- Safe to run twice.
alter table public.dashboard_banners add column if not exists company_ids uuid[] not null default '{}';

notify pgrst, 'reload schema';
