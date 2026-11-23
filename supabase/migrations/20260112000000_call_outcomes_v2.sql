-- Call outcomes, second version. The call sheet's buttons become:
--   not_reachable              stays; attempt count +1; next call date
--   call_back_later            stays; dated follow-up flagged "client requested"
--   future_requirement         New Lead -> Connected; tagged Nurture
--   interested                 -> Connected -> Meeting Scheduled (a meeting is created)
--   not_interested             -> Closed Lost, with a reason
--   wrong_contact              -> Closed Lost ("Invalid contact"), unless a new contact is entered
-- Past calls are renamed so badges, filters and the timeline stay consistent. Safe to run twice.

-- 1. Attempt count and tags on the lead ---------------------------------------------------------------------
alter table public.leads add column if not exists call_attempts integer not null default 0;
alter table public.leads add column if not exists tags text[] not null default '{}';
create index if not exists leads_tags_idx on public.leads using gin (tags);

-- 2. Rename the old outcomes ------------------------------------------------------------------------------------
alter table public.leads drop constraint if exists leads_last_call_outcome_check;

update public.activities set outcome = case outcome
    when 'no_answer' then 'not_reachable'
    when 'connected' then 'interested'
    when 'wrong_number' then 'wrong_contact'
    else outcome end
where kind = 'call' and outcome in ('no_answer', 'connected', 'wrong_number');

update public.leads set last_call_outcome = case last_call_outcome
    when 'no_answer' then 'not_reachable'
    when 'connected' then 'interested'
    when 'wrong_number' then 'wrong_contact'
    else last_call_outcome end
where last_call_outcome in ('no_answer', 'connected', 'wrong_number');

alter table public.leads add constraint leads_last_call_outcome_check check (last_call_outcome in (
  'not_reachable', 'call_back_later', 'future_requirement', 'interested', 'not_interested', 'wrong_contact'
));

-- 3. Backfill the attempt count from past unanswered calls -------------------------------------------------------
update public.leads l
set call_attempts = c.n
from (select lead_id, count(*)::int as n from public.activities where kind = 'call' and outcome = 'not_reachable' group by lead_id) c
where c.lead_id = l.id and l.call_attempts = 0;

-- 4. Catch up: every lead's call status = its latest call (calls logged before this ran could not be saved on the lead).
--    A latest call that changed the number leaves the lead at "Not called yet".
update public.leads l
set last_call_outcome = case when c.meta ? 'newPhone' then null else c.outcome end,
    last_call_at = case when c.meta ? 'newPhone' then null else c.created_at end
from (
  select distinct on (lead_id) lead_id, outcome, created_at, meta
  from public.activities
  where kind = 'call'
  order by lead_id, created_at desc
) c
where c.lead_id = l.id
  and c.outcome in ('not_reachable', 'call_back_later', 'future_requirement', 'interested', 'not_interested', 'wrong_contact')
  and l.last_call_outcome is distinct from (case when c.meta ? 'newPhone' then null else c.outcome end);

-- Nurture belongs to the "Future requirement" status: open leads whose latest call is that get the tag.
update public.leads l
set tags = array_append(l.tags, 'nurture')
where not ('nurture' = any (l.tags))
  and l.last_call_outcome = 'future_requirement'
  and l.stage not in ('closed_won', 'closed_lost');
