-- A second phone number per contact. When a call is logged as "Wrong number" with a new number, the new
-- number becomes the contact's main phone and the old one moves here, so both can still be called.

alter table public.contacts add column if not exists alt_phone text;
alter table public.contacts add column if not exists alt_phone_key text;   -- last 10 digits, like phone_key
create index if not exists contacts_alt_phone_key_idx on public.contacts (alt_phone_key);
