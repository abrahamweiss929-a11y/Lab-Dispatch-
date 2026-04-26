-- =============================================================================
-- Phase D migration: invite-based onboarding + 'office' user role.
--
-- Apply this migration to a Supabase project that already has the baseline
-- schema (supabase/schema.sql at commit df4784a or later — pre-Phase D).
--
-- This file is split into TWO PARTS that MUST be run as two separate batches
-- in the Supabase SQL editor. Postgres requires a new enum value to be
-- *committed* before it can be referenced in a check constraint or in any
-- DDL — pasting the whole file at once will fail with:
--
--     ERROR 55P04: unsafe use of new value 'office' of enum type user_role
--
-- The fix is just operational: paste PART 1, click Run, then paste PART 2,
-- click Run. The whole migration is idempotent — rerunning is safe.
--
-- Why this approach (vs. re-running supabase/schema.sql):
--
--   1. The baseline `current_role()` function has ~30 dependent RLS policies
--      across the schema. The original schema.sql does
--      `drop function if exists public.current_role()` before recreating it,
--      which fails on an existing DB with:
--
--          ERROR 2BP01: cannot drop function current_role() because other
--          objects depend on it
--
--      This migration uses `create or replace function` instead — the
--      function body is byte-identical to the baseline, this is just a
--      no-op affirmation that smooths over any local drift.
--
--   2. The original schema.sql adds the 'office' enum value and references
--      it in the invites table check constraint inside the same execution,
--      which is the 55P04 error above. This migration separates them.
--
--   3. Policies have NO downstream dependents (unlike functions), so we can
--      safely `drop policy if exists` + recreate every widened policy
--      explicitly. `drop policy ... cascade` is not valid SQL — there is
--      no cascade clause for policies. The drop+create pattern below is
--      the only correct option.
--
-- After this migration, the canonical supabase/schema.sql still describes a
-- *fresh* project. Don't apply schema.sql to an existing DB — apply this
-- migration instead.
-- =============================================================================


-- ▼▼▼ PART 1 — RUN THIS FIRST, BY ITSELF, AND CLICK RUN ▼▼▼ ====================
-- Adds 'office' to user_role. Must commit before PART 2 can reference it.

alter type public.user_role add value if not exists 'office';

-- ▲▲▲ END OF PART 1. STOP HERE. RE-OPEN A NEW QUERY TAB FOR PART 2. ▲▲▲ ========


-- ▼▼▼ PART 2 — RUN THIS SECOND, AS A SEPARATE BATCH ▼▼▼ ========================
-- Everything below depends on 'office' already existing as a committed enum
-- value. Paste from here to the end of the file into a fresh SQL editor tab.

-- ----- invite_status enum (new) ----------------------------------------------
-- Idempotent via the duplicate_object exception handler.

do $$ begin
  create type public.invite_status as enum ('pending', 'accepted', 'revoked', 'expired');
exception
  when duplicate_object then null;
end $$;

-- ----- invites table (new) ---------------------------------------------------
-- The check constraint references 'office' — safe now because PART 1 has
-- committed. `if not exists` makes this idempotent across reruns.

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

alter table public.invites enable row level security;

-- ----- invites RLS policies (new — no downstream deps, safe to drop+create) --

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

-- ----- public.current_role() — replace in place ------------------------------
-- The function body is unchanged from baseline (still returns user_role,
-- still SECURITY DEFINER, still pinned search_path). We use
-- `create or replace function` so the ~30 dependent RLS policies survive —
-- they reference the function by oid, and `create or replace` preserves
-- the oid. Compare to `drop function`, which fails with 2BP01.

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

-- ----- Widened policies ------------------------------------------------------
-- Every existing policy whose predicate was
--     public.current_role() in ('dispatcher', 'admin')
-- is widened to
--     public.current_role() in ('dispatcher', 'admin', 'office')
-- so the new 'office' role inherits dispatcher-equivalent authority.
--
-- We drop+recreate each policy by name. Postgres has no `create or replace
-- policy` and no `drop policy ... cascade`. Drop+create is the only path.
-- Policies have no downstream dependents (only functions/types do), so this
-- is safe. `drop policy if exists` makes it idempotent on rerun.
--
-- 15 widened policies total, grouped by table.

-- profiles --------------------------------------------------------------------
drop policy if exists profiles_select_dispatcher_admin on public.profiles;
create policy profiles_select_dispatcher_admin on public.profiles
  for select to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'));

-- drivers ---------------------------------------------------------------------
drop policy if exists drivers_select_dispatcher_admin on public.drivers;
create policy drivers_select_dispatcher_admin on public.drivers
  for select to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'));

-- pickup_requests -------------------------------------------------------------
drop policy if exists pickup_requests_select_dispatcher_admin on public.pickup_requests;
create policy pickup_requests_select_dispatcher_admin on public.pickup_requests
  for select to authenticated
  using (
    public.current_role() in ('dispatcher', 'admin', 'office')
    and (created_at >= now() - interval '30 days' or status <> 'completed')
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

-- routes ----------------------------------------------------------------------
drop policy if exists routes_select_dispatcher_admin on public.routes;
create policy routes_select_dispatcher_admin on public.routes
  for select to authenticated
  using (
    public.current_role() in ('dispatcher', 'admin', 'office')
    and (route_date >= (current_date - interval '30 days')::date or status <> 'completed')
  );

drop policy if exists routes_insert_dispatcher_admin on public.routes;
create policy routes_insert_dispatcher_admin on public.routes
  for insert to authenticated
  with check (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists routes_update_dispatcher_admin on public.routes;
create policy routes_update_dispatcher_admin on public.routes
  for update to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'))
  with check (public.current_role() in ('dispatcher', 'admin', 'office'));

-- stops -----------------------------------------------------------------------
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

drop policy if exists stops_delete_dispatcher_admin on public.stops;
create policy stops_delete_dispatcher_admin on public.stops
  for delete to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'));

-- driver_locations ------------------------------------------------------------
drop policy if exists driver_locations_select_dispatcher_admin on public.driver_locations;
create policy driver_locations_select_dispatcher_admin on public.driver_locations
  for select to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'));

-- messages --------------------------------------------------------------------
drop policy if exists messages_select_dispatcher_admin on public.messages;
create policy messages_select_dispatcher_admin on public.messages
  for select to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'));

drop policy if exists messages_update_dispatcher_admin on public.messages;
create policy messages_update_dispatcher_admin on public.messages
  for update to authenticated
  using (public.current_role() in ('dispatcher', 'admin', 'office'))
  with check (public.current_role() in ('dispatcher', 'admin', 'office'));

-- ▲▲▲ END OF PART 2. Migration complete. ▲▲▲ =================================
