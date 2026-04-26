-- Lab Dispatch v1 schema.
-- Idempotent. Run in Supabase SQL editor against a fresh project or re-run safely.
-- RLS is enabled on every user-facing table with a policy TODO; real policies land with the auth feature.

create extension if not exists pgcrypto;

-- Enums ---------------------------------------------------------------------

do $$ begin
  create type public.user_role as enum ('driver', 'dispatcher', 'admin');
exception
  when duplicate_object then null;
end $$;

-- Phase D: invite-based onboarding adds an 'office' role with the same
-- authority as 'dispatcher'. Existing 'dispatcher' rows continue to work
-- — backward compat is preserved. `alter type ... add value if not
-- exists` is idempotent across reruns.
do $$ begin
  alter type public.user_role add value if not exists 'office';
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.invite_status as enum ('pending', 'accepted', 'revoked', 'expired');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.request_channel as enum ('sms', 'email', 'web', 'manual');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.request_status as enum ('pending', 'assigned', 'completed', 'flagged');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.route_status as enum ('pending', 'active', 'completed');
exception
  when duplicate_object then null;
end $$;

-- Tables --------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null,
  full_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.offices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  pickup_url_token text not null unique,
  phone text,
  email text,
  address_street text,
  address_city text,
  address_state text,
  address_zip text,
  lat double precision,
  lng double precision,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.drivers (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  vehicle_label text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pickup_requests (
  id uuid primary key default gen_random_uuid(),
  office_id uuid references public.offices(id) on delete set null,
  channel public.request_channel not null,
  source_identifier text,
  raw_message text,
  urgency text,
  sample_count integer,
  special_instructions text,
  status public.request_status not null default 'pending',
  flagged_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete restrict,
  route_date date not null,
  status public.route_status not null default 'pending',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint routes_driver_id_route_date_key unique (driver_id, route_date)
);

create table if not exists public.stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  pickup_request_id uuid not null references public.pickup_requests(id) on delete restrict,
  position integer not null,
  eta_at timestamptz,
  arrived_at timestamptz,
  picked_up_at timestamptz,
  notified_10min boolean not null default false,
  created_at timestamptz not null default now(),
  unique (route_id, pickup_request_id),
  unique (route_id, position)
);

create table if not exists public.driver_locations (
  id bigserial primary key,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  route_id uuid references public.routes(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz not null default now()
);

-- Phase D: invite-based onboarding. One row per outgoing invitation;
-- the recipient hits /invite/{token} to accept. `email` is normalized
-- lowercase at write time. Tokens are 32 bytes of crypto randomness
-- (base64url-encoded; 43 chars). `expires_at` defaults to created_at +
-- 7 days. `accepted_by_profile_id` is set when the recipient signs in
-- and is the auth.users id their session resolves to.
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role public.user_role not null check (role in ('office', 'driver')),
  token text not null unique,
  status public.invite_status not null default 'pending',
  invited_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_profile_id uuid references public.profiles(id) on delete set null
);

create index if not exists idx_invites_token on public.invites (token);
create index if not exists idx_invites_email on public.invites (email);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel public.request_channel not null,
  from_identifier text not null,
  subject text,
  body text not null,
  received_at timestamptz not null default now(),
  pickup_request_id uuid references public.pickup_requests(id) on delete set null
);

-- Indexes -------------------------------------------------------------------

create index if not exists idx_pickup_requests_status_created_at
  on public.pickup_requests (status, created_at desc);

create index if not exists idx_stops_route_id_position
  on public.stops (route_id, position);

create index if not exists idx_driver_locations_driver_id_recorded_at
  on public.driver_locations (driver_id, recorded_at desc);

create index if not exists idx_offices_slug
  on public.offices (slug);

create index if not exists idx_routes_driver_id_route_date
  on public.routes (driver_id, route_date);

create index if not exists idx_messages_pickup_request_id
  on public.messages (pickup_request_id);

-- Table comments ------------------------------------------------------------

comment on table public.offices is 'Doctor offices that originate pickup requests. The pickup_url_token powers per-office public request forms.';
comment on table public.pickup_requests is 'Normalized pickup requests from any channel (SMS/email/web/manual). One row per lab pickup a driver will service.';

-- Row Level Security --------------------------------------------------------
-- RLS is enabled on every user-facing table. The service-role client
-- (interfaces/storage.real.ts, scripts/seed-live-accounts.ts, admin routes)
-- bypasses RLS by design. Policies below gate the anon/authenticated client.
-- Drivers update only their own route/stop rows; column-level narrowing
-- (started_at, completed_at, arrived_at, picked_up_at, notified_10min) is
-- enforced at the application layer — RLS grants row access only.

alter table public.profiles enable row level security;

alter table public.offices enable row level security;

alter table public.doctors enable row level security;

alter table public.drivers enable row level security;

alter table public.pickup_requests enable row level security;

alter table public.routes enable row level security;

alter table public.stops enable row level security;

alter table public.driver_locations enable row level security;

alter table public.messages enable row level security;

alter table public.invites enable row level security;

-- BEGIN RLS POLICIES --
-- Per-table Row Level Security policies. Re-runnable: every create policy is
-- preceded by a drop policy if exists with the same name. The service-role
-- client used by interfaces/storage.real.ts and server-side admin routes
-- bypasses RLS entirely; these policies apply to anon/authenticated clients.
--
-- public.current_role() is a SECURITY DEFINER helper that reads
-- profiles.role for auth.uid(). Defined SECURITY DEFINER so it sidesteps
-- policy recursion on profiles SELECT; search_path pinned to public to
-- harden against search-path attacks on definer functions.

drop function if exists public.current_role();
create or replace function public.current_role()
returns public.user_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.user_role;
begin
  select role into r from public.profiles where id = auth.uid();
  return r;
end;
$$;

grant execute on function public.current_role() to authenticated, anon;

-- profiles -------------------------------------------------------------------

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_dispatcher_admin on public.profiles;
create policy profiles_select_dispatcher_admin on public.profiles
  for select to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (public.current_role() = 'admin');

-- offices --------------------------------------------------------------------

drop policy if exists offices_select_all on public.offices;
create policy offices_select_all on public.offices
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists offices_insert_admin on public.offices;
create policy offices_insert_admin on public.offices
  for insert to authenticated
  with check (public.current_role() = 'admin');

drop policy if exists offices_update_admin on public.offices;
create policy offices_update_admin on public.offices
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists offices_delete_admin on public.offices;
create policy offices_delete_admin on public.offices
  for delete to authenticated
  using (public.current_role() = 'admin');

-- doctors --------------------------------------------------------------------

drop policy if exists doctors_select_all on public.doctors;
create policy doctors_select_all on public.doctors
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists doctors_insert_admin on public.doctors;
create policy doctors_insert_admin on public.doctors
  for insert to authenticated
  with check (public.current_role() = 'admin');

drop policy if exists doctors_update_admin on public.doctors;
create policy doctors_update_admin on public.doctors
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists doctors_delete_admin on public.doctors;
create policy doctors_delete_admin on public.doctors
  for delete to authenticated
  using (public.current_role() = 'admin');

-- drivers --------------------------------------------------------------------

drop policy if exists drivers_select_self on public.drivers;
create policy drivers_select_self on public.drivers
  for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists drivers_select_dispatcher_admin on public.drivers;
create policy drivers_select_dispatcher_admin on public.drivers
  for select to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists drivers_insert_admin on public.drivers;
create policy drivers_insert_admin on public.drivers
  for insert to authenticated
  with check (public.current_role() = 'admin');

drop policy if exists drivers_update_admin on public.drivers;
create policy drivers_update_admin on public.drivers
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists drivers_delete_admin on public.drivers;
create policy drivers_delete_admin on public.drivers
  for delete to authenticated
  using (public.current_role() = 'admin');

-- pickup_requests ------------------------------------------------------------

drop policy if exists pickup_requests_select_dispatcher_admin on public.pickup_requests;
create policy pickup_requests_select_dispatcher_admin on public.pickup_requests
  for select to authenticated
  using (
    public.current_role() in ('dispatcher', 'admin', 'office')
    and (created_at >= now() - interval '30 days' or status <> 'completed')
  );

drop policy if exists pickup_requests_select_driver on public.pickup_requests;
create policy pickup_requests_select_driver on public.pickup_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.stops s
      join public.routes r on r.id = s.route_id
      where s.pickup_request_id = pickup_requests.id
        and r.driver_id = auth.uid()
    )
  );

drop policy if exists pickup_requests_insert_dispatcher_admin on public.pickup_requests;
create policy pickup_requests_insert_dispatcher_admin on public.pickup_requests
  for insert to authenticated
  with check (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists pickup_requests_update_dispatcher_admin on public.pickup_requests;
create policy pickup_requests_update_dispatcher_admin on public.pickup_requests
  for update to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'))
  with check (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists pickup_requests_delete_admin on public.pickup_requests;
create policy pickup_requests_delete_admin on public.pickup_requests
  for delete to authenticated
  using (public.current_role() = 'admin');

-- routes ---------------------------------------------------------------------

drop policy if exists routes_select_driver on public.routes;
create policy routes_select_driver on public.routes
  for select to authenticated
  using (driver_id = auth.uid());

drop policy if exists routes_select_dispatcher_admin on public.routes;
create policy routes_select_dispatcher_admin on public.routes
  for select to authenticated
  using (
    public.current_role() in ('dispatcher', 'admin', 'office')
    and (route_date >= (current_date - interval '30 days')::date or status <> 'completed')
  );

drop policy if exists routes_select_admin on public.routes;
create policy routes_select_admin on public.routes
  for select to authenticated
  using (public.current_role() = 'admin');

drop policy if exists routes_insert_dispatcher_admin on public.routes;
create policy routes_insert_dispatcher_admin on public.routes
  for insert to authenticated
  with check (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists routes_update_dispatcher_admin on public.routes;
create policy routes_update_dispatcher_admin on public.routes
  for update to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'))
  with check (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists routes_update_driver_own on public.routes;
create policy routes_update_driver_own on public.routes
  for update to authenticated
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());

drop policy if exists routes_delete_admin on public.routes;
create policy routes_delete_admin on public.routes
  for delete to authenticated
  using (public.current_role() = 'admin');

-- stops ----------------------------------------------------------------------

drop policy if exists stops_select_driver on public.stops;
create policy stops_select_driver on public.stops
  for select to authenticated
  using (
    exists (
      select 1 from public.routes r
      where r.id = stops.route_id and r.driver_id = auth.uid()
    )
  );

drop policy if exists stops_select_dispatcher_admin on public.stops;
create policy stops_select_dispatcher_admin on public.stops
  for select to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists stops_insert_dispatcher_admin on public.stops;
create policy stops_insert_dispatcher_admin on public.stops
  for insert to authenticated
  with check (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists stops_update_dispatcher_admin on public.stops;
create policy stops_update_dispatcher_admin on public.stops
  for update to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'))
  with check (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists stops_update_driver_own on public.stops;
create policy stops_update_driver_own on public.stops
  for update to authenticated
  using (
    exists (
      select 1 from public.routes r
      where r.id = stops.route_id and r.driver_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.routes r
      where r.id = stops.route_id and r.driver_id = auth.uid()
    )
  );

drop policy if exists stops_delete_dispatcher_admin on public.stops;
create policy stops_delete_dispatcher_admin on public.stops
  for delete to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'));

-- driver_locations -----------------------------------------------------------

drop policy if exists driver_locations_select_self on public.driver_locations;
create policy driver_locations_select_self on public.driver_locations
  for select to authenticated
  using (driver_id = auth.uid());

drop policy if exists driver_locations_select_dispatcher_admin on public.driver_locations;
create policy driver_locations_select_dispatcher_admin on public.driver_locations
  for select to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists driver_locations_insert_self on public.driver_locations;
create policy driver_locations_insert_self on public.driver_locations
  for insert to authenticated
  with check (driver_id = auth.uid());

drop policy if exists driver_locations_update_admin on public.driver_locations;
create policy driver_locations_update_admin on public.driver_locations
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists driver_locations_delete_admin on public.driver_locations;
create policy driver_locations_delete_admin on public.driver_locations
  for delete to authenticated
  using (public.current_role() = 'admin');

-- messages -------------------------------------------------------------------

drop policy if exists messages_select_dispatcher_admin on public.messages;
create policy messages_select_dispatcher_admin on public.messages
  for select to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists messages_insert_admin on public.messages;
create policy messages_insert_admin on public.messages
  for insert to authenticated
  with check (public.current_role() = 'admin');

drop policy if exists messages_update_dispatcher_admin on public.messages;
create policy messages_update_dispatcher_admin on public.messages
  for update to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'))
  with check (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists messages_delete_admin on public.messages;
create policy messages_delete_admin on public.messages
  for delete to authenticated
  using (public.current_role() = 'admin');

-- invites --------------------------------------------------------------------
-- Only admins may create / list / revoke invites. Anonymous traffic at
-- /invite/{token} reaches the row through the service-role server
-- client (which bypasses RLS); RLS here is only the secondary check
-- against authenticated misuse.

drop policy if exists invites_select_admin on public.invites;
create policy invites_select_admin on public.invites
  for select to authenticated
  using (public.current_role() = 'admin');

drop policy if exists invites_insert_admin on public.invites;
create policy invites_insert_admin on public.invites
  for insert to authenticated
  with check (public.current_role() = 'admin');

drop policy if exists invites_update_admin on public.invites;
create policy invites_update_admin on public.invites
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists invites_delete_admin on public.invites;
create policy invites_delete_admin on public.invites
  for delete to authenticated
  using (public.current_role() = 'admin');

-- END RLS POLICIES --
