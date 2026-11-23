-- New call outcome: "Future requirement" (the client has no need now but will later). It is shown as the lead's
-- call status and can be filtered on; it never moves the lead to another stage.

alter table public.leads drop constraint if exists leads_last_call_outcome_check;
alter table public.leads add constraint leads_last_call_outcome_check
  check (last_call_outcome in ('connected', 'no_answer', 'call_back_later', 'not_interested', 'wrong_number', 'future_requirement'));

-- Calls logged as "Future requirement" before this ran could not be saved as the lead's status: catch them up.
update public.leads l
set last_call_outcome = c.outcome, last_call_at = c.created_at
from (
  select distinct on (lead_id) lead_id, outcome, created_at, meta
  from public.activities
  where kind = 'call'
  order by lead_id, created_at desc
) c
where c.lead_id = l.id
  and c.outcome = 'future_requirement'
  and not (c.meta ? 'newPhone')
  and l.last_call_outcome is distinct from 'future_requirement';
