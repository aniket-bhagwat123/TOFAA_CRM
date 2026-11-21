-- Deleting a user failed ("Database error deleting user") once they had audit or activity rows,
-- because those rows referenced the profile. Keep the history and just clear the actor instead.

alter table public.audit_log
  drop constraint audit_log_actor_id_fkey,
  add constraint audit_log_actor_id_fkey
    foreign key (actor_id) references public.profiles (id) on delete set null;

alter table public.activity_feed
  drop constraint activity_feed_actor_id_fkey,
  add constraint activity_feed_actor_id_fkey
    foreign key (actor_id) references public.profiles (id) on delete set null;
