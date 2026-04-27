-- =============================================================================
-- 2026-04-27 — Unify back-office roles into a single 'office' role.
--
-- Before this migration:
--   * Three back-office roles existed: 'admin', 'dispatcher', and (after
--     Phase D) 'office'.
--   * RLS policies gated on either `current_role() = 'admin'` (22 policies)
--     or `current_role() in ('dispatcher','admin','office')` (15 policies).
--
-- After this migration:
--   * Every back-office user has role = 'office'. The 'admin' and 'dispatcher'
--     enum values stay in the user_role type (Postgres can't drop enum values
--     without a full type rebuild), but no row references them and no policy
--     mentions them.
--   * Every formerly-gated RLS policy collapses to `current_role() = 'office'`.
--     'office' users now have full access to everything that 'admin' or
--     'dispatcher' could do before — no sub-gating.
--   * Driver permissions are unchanged. `_select_self`, `_select_driver`,
--     `_update_driver_own`, `_insert_self` (driver_locations) all stay as-is.
--
-- What stays:
--   * The user_role enum (with leftover 'admin' and 'dispatcher' values
--     unused but reachable).
--   * The 'driver' role and all driver-specific policies.
--   * `public.current_role()` function — body is unchanged; we use
--     `create or replace function` to avoid the cascade-drop error from
--     all dependent policies.
--   * `_select_self`, `_select_driver`, `_update_driver_own`,
--     `driver_locations_insert_self`, `offices_select_all`,
--     `doctors_select_all`, `pickup_requests_select_driver` — none of
--     these reference admin or dispatcher.
--
-- Idempotent: every statement is safe to re-run on a database that's
-- already been migrated. The data update is naturally idempotent (no rows
-- match after first run); every policy drop uses `if exists`; the function
-- replacement preserves oid.
--
-- Manual application notes:
--   1. Open Supabase SQL Editor for the production project.
--   2. Paste this entire file as one batch and click Run.
--   3. Verify with the queries at the bottom of the file (commented out).
--   4. After success, re-deploy or restart the Next.js app so its
--      session cache picks up the new roles.
-- =============================================================================


-- ▼▼▼ PART 1 — Migrate existing rows ▼▼▼ ======================================
-- Move every back-office user to the unified 'office' role.

update public.profiles
   set role = 'office'
 where role in ('admin', 'dispatcher');


-- ▼▼▼ PART 2 — Replace current_role() in place ▼▼▼ ============================
-- Body is unchanged from the prior migration. We use `create or replace
-- function` (NOT drop+create) so the ~37 dependent policies survive — they
-- bind by oid, and `create or replace` preserves the oid.

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


-- ▼▼▼ PART 3 — Drop the legacy admin/dispatcher policies ▼▼▼ ==================
-- We drop by their original names. `if exists` makes this safe on re-run,
-- and on a database that's already been migrated past step 4 below.
-- Postgres has no `create or replace policy` and no cascade clause for
-- policies, so drop+create is the only path.

-- profiles -------------------------------------------------------------------
drop policy if exists profiles_select_dispatcher_admin on public.profiles;
drop policy if exists profiles_update_admin            on public.profiles;
drop policy if exists profiles_delete_admin            on public.profiles;

-- offices --------------------------------------------------------------------
drop policy if exists offices_insert_admin on public.offices;
drop policy if exists offices_update_admin on public.offices;
drop policy if exists offices_delete_admin on public.offices;

-- doctors --------------------------------------------------------------------
drop policy if exists doctors_insert_admin on public.doctors;
drop policy if exists doctors_update_admin on public.doctors;
drop policy if exists doctors_delete_admin on public.doctors;

-- drivers --------------------------------------------------------------------
drop policy if exists drivers_select_dispatcher_admin on public.drivers;
drop policy if exists drivers_insert_admin            on public.drivers;
drop policy if exists drivers_update_admin            on public.drivers;
drop policy if exists drivers_delete_admin            on public.drivers;

-- pickup_requests ------------------------------------------------------------
drop policy if exists pickup_requests_select_dispatcher_admin on public.pickup_requests;
drop policy if exists pickup_requests_insert_dispatcher_admin on public.pickup_requests;
drop policy if exists pickup_requests_update_dispatcher_admin on public.pickup_requests;
drop policy if exists pickup_requests_delete_admin            on public.pickup_requests;

-- routes ---------------------------------------------------------------------
drop policy if exists routes_select_dispatcher_admin on public.routes;
drop policy if exists routes_select_admin            on public.routes;
drop policy if exists routes_insert_dispatcher_admin on public.routes;
drop policy if exists routes_update_dispatcher_admin on public.routes;
drop policy if exists routes_delete_admin            on public.routes;

-- stops ----------------------------------------------------------------------
drop policy if exists stops_select_dispatcher_admin on public.stops;
drop policy if exists stops_insert_dispatcher_admin on public.stops;
drop policy if exists stops_update_dispatcher_admin on public.stops;
drop policy if exists stops_delete_dispatcher_admin on public.stops;

-- driver_locations -----------------------------------------------------------
drop policy if exists driver_locations_select_dispatcher_admin on public.driver_locations;
drop policy if exists driver_locations_update_admin            on public.driver_locations;
drop policy if exists driver_locations_delete_admin            on public.driver_locations;

-- messages -------------------------------------------------------------------
drop policy if exists messages_select_dispatcher_admin on public.messages;
drop policy if exists messages_insert_admin            on public.messages;
drop policy if exists messages_update_dispatcher_admin on public.messages;
drop policy if exists messages_delete_admin            on public.messages;

-- invites --------------------------------------------------------------------
drop policy if exists invites_select_admin on public.invites;
drop policy if exists invites_insert_admin on public.invites;
drop policy if exists invites_update_admin on public.invites;
drop policy if exists invites_delete_admin on public.invites;


-- ▼▼▼ PART 4 — Create unified office policies ▼▼▼ =============================
-- Each new policy gates on `current_role() = 'office'` exclusively. Names
-- end in `_office` to make the role they grant explicit and to avoid name
-- collision with any legacy policy that might survive a partial run.
-- `drop policy if exists ... _office on ...` precedes each create for
-- idempotent reruns.

-- profiles -------------------------------------------------------------------
-- profiles_select_self stays untouched (everyone reads their own row).
drop policy if exists profiles_select_office on public.profiles;
create policy profiles_select_office on public.profiles
  for select to authenticated
  using (public.current_role() = 'office');

drop policy if exists profiles_update_office on public.profiles;
create policy profiles_update_office on public.profiles
  for update to authenticated
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists profiles_delete_office on public.profiles;
create policy profiles_delete_office on public.profiles
  for delete to authenticated
  using (public.current_role() = 'office');

-- offices --------------------------------------------------------------------
-- offices_select_all stays — every authenticated user can read offices.
drop policy if exists offices_insert_office on public.offices;
create policy offices_insert_office on public.offices
  for insert to authenticated
  with check (public.current_role() = 'office');

drop policy if exists offices_update_office on public.offices;
create policy offices_update_office on public.offices
  for update to authenticated
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists offices_delete_office on public.offices;
create policy offices_delete_office on public.offices
  for delete to authenticated
  using (public.current_role() = 'office');

-- doctors --------------------------------------------------------------------
-- doctors_select_all stays.
drop policy if exists doctors_insert_office on public.doctors;
create policy doctors_insert_office on public.doctors
  for insert to authenticated
  with check (public.current_role() = 'office');

drop policy if exists doctors_update_office on public.doctors;
create policy doctors_update_office on public.doctors
  for update to authenticated
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists doctors_delete_office on public.doctors;
create policy doctors_delete_office on public.doctors
  for delete to authenticated
  using (public.current_role() = 'office');

-- drivers --------------------------------------------------------------------
-- drivers_select_self stays (drivers see their own row).
drop policy if exists drivers_select_office on public.drivers;
create policy drivers_select_office on public.drivers
  for select to authenticated
  using (public.current_role() = 'office');

drop policy if exists drivers_insert_office on public.drivers;
create policy drivers_insert_office on public.drivers
  for insert to authenticated
  with check (public.current_role() = 'office');

drop policy if exists drivers_update_office on public.drivers;
create policy drivers_update_office on public.drivers
  for update to authenticated
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists drivers_delete_office on public.drivers;
create policy drivers_delete_office on public.drivers
  for delete to authenticated
  using (public.current_role() = 'office');

-- pickup_requests ------------------------------------------------------------
-- pickup_requests_select_driver stays (drivers see their own stops' requests).
-- The previous `_select_dispatcher_admin` had a 30-day soft filter; office
-- users now get full access — no time filter — to match the unified
-- "office can do everything" policy.
drop policy if exists pickup_requests_select_office on public.pickup_requests;
create policy pickup_requests_select_office on public.pickup_requests
  for select to authenticated
  using (public.current_role() = 'office');

drop policy if exists pickup_requests_insert_office on public.pickup_requests;
create policy pickup_requests_insert_office on public.pickup_requests
  for insert to authenticated
  with check (public.current_role() = 'office');

drop policy if exists pickup_requests_update_office on public.pickup_requests;
create policy pickup_requests_update_office on public.pickup_requests
  for update to authenticated
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists pickup_requests_delete_office on public.pickup_requests;
create policy pickup_requests_delete_office on public.pickup_requests
  for delete to authenticated
  using (public.current_role() = 'office');

-- routes ---------------------------------------------------------------------
-- routes_select_driver and routes_update_driver_own stay.
-- Two pre-unification policies (`_select_dispatcher_admin` with a 30-day
-- filter, plus `_select_admin` with no filter) collapse into one office
-- policy with no time filter.
drop policy if exists routes_select_office on public.routes;
create policy routes_select_office on public.routes
  for select to authenticated
  using (public.current_role() = 'office');

drop policy if exists routes_insert_office on public.routes;
create policy routes_insert_office on public.routes
  for insert to authenticated
  with check (public.current_role() = 'office');

drop policy if exists routes_update_office on public.routes;
create policy routes_update_office on public.routes
  for update to authenticated
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists routes_delete_office on public.routes;
create policy routes_delete_office on public.routes
  for delete to authenticated
  using (public.current_role() = 'office');

-- stops ----------------------------------------------------------------------
-- stops_select_driver and stops_update_driver_own stay.
drop policy if exists stops_select_office on public.stops;
create policy stops_select_office on public.stops
  for select to authenticated
  using (public.current_role() = 'office');

drop policy if exists stops_insert_office on public.stops;
create policy stops_insert_office on public.stops
  for insert to authenticated
  with check (public.current_role() = 'office');

drop policy if exists stops_update_office on public.stops;
create policy stops_update_office on public.stops
  for update to authenticated
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists stops_delete_office on public.stops;
create policy stops_delete_office on public.stops
  for delete to authenticated
  using (public.current_role() = 'office');

-- driver_locations -----------------------------------------------------------
-- driver_locations_select_self and driver_locations_insert_self stay.
drop policy if exists driver_locations_select_office on public.driver_locations;
create policy driver_locations_select_office on public.driver_locations
  for select to authenticated
  using (public.current_role() = 'office');

drop policy if exists driver_locations_update_office on public.driver_locations;
create policy driver_locations_update_office on public.driver_locations
  for update to authenticated
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists driver_locations_delete_office on public.driver_locations;
create policy driver_locations_delete_office on public.driver_locations
  for delete to authenticated
  using (public.current_role() = 'office');

-- messages -------------------------------------------------------------------
drop policy if exists messages_select_office on public.messages;
create policy messages_select_office on public.messages
  for select to authenticated
  using (public.current_role() = 'office');

drop policy if exists messages_insert_office on public.messages;
create policy messages_insert_office on public.messages
  for insert to authenticated
  with check (public.current_role() = 'office');

drop policy if exists messages_update_office on public.messages;
create policy messages_update_office on public.messages
  for update to authenticated
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists messages_delete_office on public.messages;
create policy messages_delete_office on public.messages
  for delete to authenticated
  using (public.current_role() = 'office');

-- invites --------------------------------------------------------------------
drop policy if exists invites_select_office on public.invites;
create policy invites_select_office on public.invites
  for select to authenticated
  using (public.current_role() = 'office');

drop policy if exists invites_insert_office on public.invites;
create policy invites_insert_office on public.invites
  for insert to authenticated
  with check (public.current_role() = 'office');

drop policy if exists invites_update_office on public.invites;
create policy invites_update_office on public.invites
  for update to authenticated
  using (public.current_role() = 'office')
  with check (public.current_role() = 'office');

drop policy if exists invites_delete_office on public.invites;
create policy invites_delete_office on public.invites
  for delete to authenticated
  using (public.current_role() = 'office');


-- ▲▲▲ Migration complete. ▲▲▲ ================================================
--
-- Verification queries (uncomment and run separately to confirm):
--
--   -- 1. No back-office user is left on a legacy role:
--   select role, count(*) from public.profiles group by role;
--   -- Expect: 'office' and 'driver' only (plus possibly stale 'admin' /
--   -- 'dispatcher' rows count = 0).
--
--   -- 2. No surviving policy references 'admin' or 'dispatcher':
--   select schemaname, tablename, policyname, qual::text as predicate
--     from pg_policies
--    where schemaname = 'public'
--      and (qual::text like '%''admin''%' or qual::text like '%''dispatcher''%');
--   -- Expect: 0 rows.
--
--   -- 3. Office-gated policies are in place (count >= 30):
--   select count(*) as office_policy_count
--     from pg_policies
--    where schemaname = 'public'
--      and qual::text like '%''office''%';
--   -- Expect: 30+ rows.
