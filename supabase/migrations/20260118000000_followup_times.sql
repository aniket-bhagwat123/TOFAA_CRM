-- Follow-ups v3 data catch-up. Safe to run twice.
--  1. Every open follow-up has a time, so every one rings: 10:00 AM IST on its day (for today, if 10:00 has passed,
--     the next full hour). New follow-ups get this from the app.
--  2. One open check-in per client: older duplicate check-ins are closed as "superseded", keeping the newest
--     (occasion calls and campaign calls are separate and untouched).

update public.tasks
set due_at = case
  when due_date = (now() at time zone 'Asia/Kolkata')::date
    then greatest((due_date + time '10:00') at time zone 'Asia/Kolkata', date_trunc('hour', now()) + interval '1 hour')
  else (due_date + time '10:00') at time zone 'Asia/Kolkata'
end
where done_at is null and due_at is null;

update public.tasks t
set done_at = now(), outcome = 'superseded'
where t.done_at is null and t.lead_id is null and t.campaign_id is null and t.occasion_key is null
  and exists (
    select 1 from public.tasks n
    where n.company_id = t.company_id and n.id <> t.id and n.done_at is null
      and n.lead_id is null and n.campaign_id is null and n.occasion_key is null
      and n.created_at > t.created_at
  );
