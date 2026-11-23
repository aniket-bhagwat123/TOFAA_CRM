-- The outcome of the most recent logged call, kept on the lead so cards and the table can show it
-- and the lists can filter by it without reading the whole timeline.

alter table public.leads add column if not exists last_call_outcome text
  check (last_call_outcome in ('connected', 'no_answer', 'call_back_later', 'not_interested', 'wrong_number'));
alter table public.leads add column if not exists last_call_at timestamptz;

-- Backfill from the call history.
update public.leads l
set last_call_outcome = c.outcome, last_call_at = c.created_at
from (
  select distinct on (lead_id) lead_id, outcome, created_at
  from public.activities
  where kind = 'call' and outcome in ('connected', 'no_answer', 'call_back_later', 'not_interested', 'wrong_number')
  order by lead_id, created_at desc
) c
where c.lead_id = l.id and l.last_call_outcome is null;

create index if not exists leads_last_call_outcome_idx on public.leads (last_call_outcome);
