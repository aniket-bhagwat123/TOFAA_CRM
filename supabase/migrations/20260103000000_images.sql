-- Profile photos (users) and client photos (leads). Files live in private Storage buckets; the backend
-- uploads them and hands out short-lived signed URLs, so nothing is publicly readable.

alter table public.profiles add column if not exists avatar_path text;
alter table public.contacts add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('client-images', 'client-images', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
-- No storage.objects policies on purpose: only the backend (service role) reads and writes.
