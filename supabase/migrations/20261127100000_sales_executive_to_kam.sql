-- Sales Executive and KAM are one role now: KAM (Key Account Manager).
-- The enum keeps the old 'sales_executive' value (Postgres cannot drop one in place); nothing uses it after this.
-- Safe to run more than once.
update public.profiles set role = 'kam' where role = 'sales_executive';
alter table public.profiles alter column role set default 'kam';
