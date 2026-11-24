-- Follow-ups board, v2:
--   due_at            the due time when one is known (a snooze "In 2 hrs", a callback time); due_date stays the day
--   snooze_count      how often the follow-up was pushed back; 3 or more shows "Repeatedly postponed" to the manager
--   client_requested  the client asked for this callback ("Call back later"): badge, sorted first, needs a note to snooze
-- Safe to run twice.

alter table public.tasks add column if not exists due_at timestamptz;
alter table public.tasks add column if not exists snooze_count integer not null default 0;
alter table public.tasks add column if not exists client_requested boolean not null default false;

-- Callbacks logged before this ran carried the flag only in their title.
update public.tasks set client_requested = true
where client_requested = false and title ilike '%client requested%';
