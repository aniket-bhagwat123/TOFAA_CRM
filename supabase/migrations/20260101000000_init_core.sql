-- Core schema: profiles, single-session tracking, audit, activity.

create type public.user_role as enum ('superadmin', 'admin', 'user');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'user',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per user = one active session. The primary key on user_id is what enforces it.
create table public.user_sessions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  session_id text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id),
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.activity_feed (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id),
  kind text not null,
  summary text not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);

-- Session functions (called by the backend with the service role only) -----------------------

-- Atomically take the account's session slot. Succeeds when there is no session yet, or the
-- existing one has been idle for p_idle_seconds (abandoned). Returns false if someone else holds it.
create function public.claim_user_session(p_user_id uuid, p_session_id text, p_idle_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_claimed boolean;
begin
  insert into public.user_sessions (user_id, session_id)
  values (p_user_id, p_session_id)
  on conflict (user_id) do update
    set session_id = excluded.session_id, created_at = now(), last_seen_at = now()
    where public.user_sessions.last_seen_at < now() - make_interval(secs => p_idle_seconds)
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end $$;

-- True if this is still the user's live session; also bumps last_seen_at.
create function public.touch_user_session(p_user_id uuid, p_session_id text, p_idle_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  update public.user_sessions set last_seen_at = now()
  where user_id = p_user_id and session_id = p_session_id
    and last_seen_at >= now() - make_interval(secs => p_idle_seconds)
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

revoke all on function public.claim_user_session(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.touch_user_session(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_user_session(uuid, text, integer) to service_role;
grant execute on function public.touch_user_session(uuid, text, integer) to service_role;

-- Helpers for RLS
create function public.is_superadmin() returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'superadmin') $$;

create function public.is_admin() returns boolean  -- superadmin or admin
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('superadmin', 'admin')) $$;

-- RLS (backend uses the service role; these protect direct access)
alter table public.profiles enable row level security;
alter table public.user_sessions enable row level security;  -- no policies: service role only
alter table public.audit_log enable row level security;
alter table public.activity_feed enable row level security;

create policy profiles_read on public.profiles for select
  using (id = auth.uid() or public.is_admin());
create policy audit_superadmin_read on public.audit_log for select using (public.is_superadmin());
create policy activity_admin_read on public.activity_feed for select using (public.is_admin());

-- The backend talks to these tables as service_role. Newer Supabase projects do not grant API
-- roles access to new tables automatically, so grant it explicitly.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
