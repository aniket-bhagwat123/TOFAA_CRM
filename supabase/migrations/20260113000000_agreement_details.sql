-- The agreement itself, prepared in the CRM before it is signed: requirement packages, scope of work, commercials
-- (transportation, GST), contract terms, signees and remarks. It prints as a PDF on the letterhead. Uploading the
-- signed copy works as before and still moves the lead to Agreement & Payment. Safe to run twice.

alter table public.agreements add column if not exists details jsonb;              -- the prepared agreement (see agreements/schemas.py)
alter table public.agreements add column if not exists total_amount numeric(14, 2); -- total project cost incl. transport and GST
alter table public.agreements add column if not exists prepared_at timestamptz;
