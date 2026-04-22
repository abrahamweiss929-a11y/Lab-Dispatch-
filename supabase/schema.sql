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
  created_at timestamptz not null default now()
);

create table if not exists public.stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  pickup_request_id uuid not null references public.pickup_requests(id) on delete restrict,
  position integer not null,
  eta_at timestamptz,
  arrived_at timestamptz,
  picked_up_at timestamptz,
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
-- RLS is enabled on every user-facing table. With RLS on and no policies,
-- authenticated clients see zero rows until the auth feature adds policies.

-- TODO(auth): policies land with the auth feature; see docs/plans/auth.md
alter table public.profiles enable row level security;

-- TODO(auth): policies land with the auth feature; see docs/plans/auth.md
alter table public.offices enable row level security;

-- TODO(auth): policies land with the auth feature; see docs/plans/auth.md
alter table public.doctors enable row level security;

-- TODO(auth): policies land with the auth feature; see docs/plans/auth.md
alter table public.drivers enable row level security;

-- TODO(auth): policies land with the auth feature; see docs/plans/auth.md
alter table public.pickup_requests enable row level security;

-- TODO(auth): policies land with the auth feature; see docs/plans/auth.md
alter table public.routes enable row level security;

-- TODO(auth): policies land with the auth feature; see docs/plans/auth.md
alter table public.stops enable row level security;

-- TODO(auth): policies land with the auth feature; see docs/plans/auth.md
alter table public.driver_locations enable row level security;

-- TODO(auth): policies land with the auth feature; see docs/plans/auth.md
alter table public.messages enable row level security;
