-- Whose the second number is. When a "Wrong number" call gives the right person's number (and name), the old
-- number and the old name move to alt_phone / alt_name, so the lead page can show both people.

alter table public.contacts add column if not exists alt_name text;

-- Backfill: the name that was replaced on the latest number change (kept in the call's meta).
update public.contacts ct
set alt_name = coalesce(a.meta->>'oldName', ct.name)
from public.leads l
join lateral (
  select meta from public.activities
  where lead_id = l.id and kind = 'call' and meta ? 'newPhone'
  order by created_at desc limit 1
) a on true
where l.contact_id = ct.id and ct.alt_phone is not null and ct.alt_name is null;

-- A changed number has not been called yet: clear the "Wrong number" status left on those leads.
update public.leads l
set last_call_outcome = null, last_call_at = null
where l.last_call_outcome = 'wrong_number'
  and exists (
    select 1 from public.activities a
    where a.lead_id = l.id and a.kind = 'call' and a.meta ? 'newPhone'
      and a.created_at >= coalesce(l.last_call_at, a.created_at)
  );
