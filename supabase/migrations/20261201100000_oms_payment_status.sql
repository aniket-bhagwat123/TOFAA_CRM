-- The payment status OMS reports for an order (Finance confirms payment in OMS). The CRM only shows it.
-- Run after 20261130100000_oms_handover.sql. Safe to run twice. No row yet means "pending".
alter table public.orders add column if not exists oms_payment_status text;
alter table public.orders add column if not exists oms_payment_changed_at timestamptz;   -- older messages are ignored
alter table public.orders drop constraint if exists orders_oms_payment_status_check;
alter table public.orders add constraint orders_oms_payment_status_check check (oms_payment_status in ('pending', 'success'));
notify pgrst, 'reload schema';
