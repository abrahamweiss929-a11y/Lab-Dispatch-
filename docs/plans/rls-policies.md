# Plan: Real Row-Level Security policies

**Slug:** rls-policies
**SPEC reference:** Auth & roles (drivers / dispatchers / admins); data access rules in the integration spec — see also `docs/plans/auth-skeleton.md`, `docs/plans/db-schema.md`.
**Status:** draft

## Goal

Replace the `-- TODO(auth)` RLS placeholders in `supabase/schema.sql` with real, role-aware Row-Level Security policies for all 9 user-facing tables so that the anon/user-session Supabase client enforces the spec's visibility rules (drivers see only their own routes/stops; dispatchers see everything for today + last 30 days; admins see everything). Policies must be applied to both the schema-as-source-of-truth file and to the live Supabase project.

## Out of scope

- Changing any application code paths that go through the service-role admin client. That client BYPASSES RLS by design and must keep working (admin API routes, seed script, `interfaces/storage.real.ts`, `getUserFromSession()`'s profile lookup).
- App-layer authorization (role checks in route handlers). RLS is the DB safety net; app checks are elsewhere.
- Column-level grants. Drivers get row access to whole rows on their own routes/stops; the app decides which columns they try to update.
- Policy performance tuning (explain plans, functional indexes on RLS predicates).
- Integration tests that hit a live DB with user JWTs. Manual verification only for v1 — automated policy tests are tracked as a follow-up.
- Proper migration tooling (numbered migrations, `supabase db push`, `pg` as a dep). The one-shot apply script prints SQL for manual paste; see "Open questions".
- Policies for the built-in `auth.*` schema — out of scope and owned by Supabase.

## Files to create or modify

- `supabase/schema.sql` — MODIFY. Remove the nine `-- TODO(auth)` comments (keep the `alter table ... enable row level security` lines). Append a new "Row Level Security — Policies" section with:
  - a helper function `public.current_role()`,
  - per-table `drop policy if exists` + `create policy` blocks for all 9 tables, idempotent for re-runs.
- `lib/schema.test.ts` — MODIFY. Replace the `retains at least one TODO(auth) comment` test with assertions that (a) `public.current_role()` is declared, (b) each of the 9 user-facing tables has at least one `create policy` referencing it by name, (c) every policy block is guarded by `drop policy if exists` for idempotency.
- `scripts/apply-rls-policies.ts` — CREATE. Node/tsx script that reads `supabase/schema.sql`, extracts the "Row Level Security — Policies" section (between two stable marker comments), prints it to stdout with a short preamble, and exits 0. Intended to be piped or manually pasted into the Supabase SQL Editor. No DB connection is made. No new dependencies.
- `package.json` — MODIFY. Add `"db:rls": "tsx scripts/apply-rls-policies.ts"` to `scripts`.
- `docs/plans/rls-policies.md` — THIS FILE.

## Interfaces / contracts

### DB helper function

```sql
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
```

- `security definer` so the function itself can read `profiles` regardless of the caller's policies (prevents policy-recursion on `profiles` SELECT).
- `stable` so Postgres caches the result per statement.
- `set search_path = public` hardens against search-path attacks on definer functions.
- Grant `execute` to `authenticated` (and `anon` is fine — returns null for anon callers since `auth.uid()` is null).

### Section markers in `supabase/schema.sql`

Two exact lines bracket the policies block so `scripts/apply-rls-policies.ts` can extract it:

```
-- BEGIN RLS POLICIES --
...
-- END RLS POLICIES --
```

### Naming convention

`{table}_{op}_{audience}`, e.g. `routes_select_driver`, `stops_update_dispatcher_admin`. One policy per (table, op, audience) triple; audiences are `self`, `driver`, `dispatcher_admin`, or `admin`. A row may match multiple policies — Postgres ORs them for permissive policies, which is what we want.

### Per-table policy matrix

All policies are `create policy ... to authenticated`. No `anon` access to any user-facing table; the public pickup form goes through a server route which uses the admin client (bypasses RLS).

**profiles**
- `profiles_select_self` — SELECT USING (`id = auth.uid()`).
- `profiles_select_dispatcher_admin` — SELECT USING (`public.current_role() in ('dispatcher','admin')`).
- `profiles_update_self` — UPDATE USING (`id = auth.uid()`) WITH CHECK (`id = auth.uid()`).
- `profiles_update_admin` — UPDATE USING (`public.current_role() = 'admin'`) WITH CHECK (`public.current_role() = 'admin'`).
- `profiles_delete_admin` — DELETE USING (`public.current_role() = 'admin'`).
- NO insert policy. INSERTs come from `auth.admin.createUser` + service role (bypasses RLS).
- Rationale: `getUserFromSession()` in `lib/supabase-server.ts` uses the admin client today, so it bypasses RLS, but `profiles_select_self` is the safety net if a future refactor routes that read through the user client.

**offices**
- `offices_select_all` — SELECT USING (`auth.uid() is not null`). All authenticated users; drivers need office names/addresses for their stops.
- `offices_insert_admin` — INSERT WITH CHECK (`public.current_role() = 'admin'`).
- `offices_update_admin` — UPDATE USING / WITH CHECK `= 'admin'`.
- `offices_delete_admin` — DELETE USING `= 'admin'`.

**doctors**
- `doctors_select_all` — SELECT USING (`auth.uid() is not null`).
- `doctors_insert_admin`, `doctors_update_admin`, `doctors_delete_admin` — same shape as offices.

**drivers** (per-driver profile extension)
- `drivers_select_self` — SELECT USING (`profile_id = auth.uid()`).
- `drivers_select_dispatcher_admin` — SELECT USING (`public.current_role() in ('dispatcher','admin')`).
- `drivers_insert_admin` — INSERT WITH CHECK `= 'admin'`.
- `drivers_update_admin` — UPDATE USING / WITH CHECK `= 'admin'`.
- `drivers_delete_admin` — DELETE USING `= 'admin'`.

**pickup_requests**
- `pickup_requests_select_dispatcher_admin` — SELECT USING
  ```
  public.current_role() in ('dispatcher','admin')
  and (created_at >= now() - interval '30 days' or status <> 'completed')
  ```
  Dispatchers/admins see everything created in the last 30 days, plus any still-open completion regardless of age.
- `pickup_requests_select_driver` — SELECT USING
  ```
  exists (
    select 1 from public.stops s
    join public.routes r on r.id = s.route_id
    where s.pickup_request_id = pickup_requests.id
      and r.driver_id = auth.uid()
  )
  ```
  Drivers see requests referenced by a stop on a route they own.
- `pickup_requests_insert_dispatcher_admin` — INSERT WITH CHECK `in ('dispatcher','admin')`. Drivers cannot create. Channel-routed inserts (SMS webhook, email webhook, pickup-form submit) all go through the service-role client and bypass RLS.
- `pickup_requests_update_dispatcher_admin` — UPDATE USING / WITH CHECK `in ('dispatcher','admin')`.
- `pickup_requests_delete_admin` — DELETE USING `= 'admin'`.

**routes**
- `routes_select_driver` — SELECT USING (`driver_id = auth.uid()`).
- `routes_select_dispatcher_admin` — SELECT USING
  ```
  public.current_role() in ('dispatcher','admin')
  and (route_date >= (current_date - interval '30 days')::date or status <> 'completed')
  ```
  The 30-day window applies to dispatchers; admins satisfy the role predicate in the same policy and also in their own `routes_select_admin` which drops the date filter.
- `routes_select_admin` — SELECT USING (`public.current_role() = 'admin'`). Lets admins see the full history without the 30-day cap.
- `routes_insert_dispatcher_admin` — INSERT WITH CHECK `in ('dispatcher','admin')`.
- `routes_update_dispatcher_admin` — UPDATE USING / WITH CHECK `in ('dispatcher','admin')`.
- `routes_update_driver_own` — UPDATE USING (`driver_id = auth.uid()`) WITH CHECK (`driver_id = auth.uid()`). Drivers can update their own route row; narrowing of which columns they change (`started_at`, `completed_at`) is enforced by the app. Document this in the schema comment header.
- `routes_delete_admin` — DELETE USING `= 'admin'`.

**stops**
- `stops_select_driver` — SELECT USING
  ```
  exists (select 1 from public.routes r
          where r.id = stops.route_id and r.driver_id = auth.uid())
  ```
- `stops_select_dispatcher_admin` — SELECT USING `in ('dispatcher','admin')`. No 30-day window at the stop level — if the dispatcher can see the route, they can see its stops; the route-level window already scopes what's visible in practice.
- `stops_insert_dispatcher_admin` — INSERT WITH CHECK `in ('dispatcher','admin')`.
- `stops_update_dispatcher_admin` — UPDATE USING / WITH CHECK `in ('dispatcher','admin')`.
- `stops_update_driver_own` — UPDATE USING (`exists (select 1 from routes r where r.id = stops.route_id and r.driver_id = auth.uid())`) WITH CHECK (same). Drivers update their own stops; column narrowing (`arrived_at`, `picked_up_at`, `notified_10min`) is enforced by the app.
- `stops_delete_dispatcher_admin` — DELETE USING `in ('dispatcher','admin')`.

**driver_locations**
- `driver_locations_select_self` — SELECT USING (`driver_id = auth.uid()`).
- `driver_locations_select_dispatcher_admin` — SELECT USING `in ('dispatcher','admin')`.
- `driver_locations_insert_self` — INSERT WITH CHECK (`driver_id = auth.uid()`). Drivers post their own GPS pings.
- `driver_locations_update_admin` — UPDATE USING / WITH CHECK `= 'admin'`. Not expected to happen in practice.
- `driver_locations_delete_admin` — DELETE USING `= 'admin'`.

**messages**
- `messages_select_dispatcher_admin` — SELECT USING `in ('dispatcher','admin')`.
- `messages_insert_admin` — INSERT WITH CHECK `= 'admin'`. In practice webhook inserts come through the service-role client; this policy exists as a narrow fallback for admin-console manual inserts.
- `messages_update_dispatcher_admin` — UPDATE USING / WITH CHECK `in ('dispatcher','admin')`.
- `messages_delete_admin` — DELETE USING `= 'admin'`.
- No driver access at all — drivers don't use the inbox.

### Apply script contract

`scripts/apply-rls-policies.ts`:
- `main(): Promise<void>` — reads `supabase/schema.sql`, slices between `-- BEGIN RLS POLICIES --` and `-- END RLS POLICIES --`, prints the slice preceded by a short instruction banner ("Paste into Supabase SQL Editor: Project → SQL → New query"), exits `0`.
- Throws non-zero if the markers are missing or empty.
- No network calls. No imports from `@supabase/*`. No env vars required.

## Implementation steps

1. **Edit `supabase/schema.sql` — remove TODO comments.** Delete each `-- TODO(auth): policies land with the auth feature; see docs/plans/auth.md` line (keeping the `alter table ... enable row level security` line intact) for all 9 tables. Verify by re-reading the file.
2. **Append the policies section to `supabase/schema.sql`.** After the existing `-- Row Level Security` block, add:
   - The `-- BEGIN RLS POLICIES --` marker.
   - A short comment block explaining: service-role bypasses RLS; `current_role()` is a SECURITY DEFINER helper; per-table sections follow.
   - `drop function if exists public.current_role();` followed by `create or replace function public.current_role() ...` (see signature above).
   - `grant execute on function public.current_role() to authenticated, anon;`.
   - One section per table, in the same order as the table definitions, each section containing `drop policy if exists <name> on <table>;` pairs followed by `create policy <name> on <table> ...`. Every policy `to authenticated`.
   - The `-- END RLS POLICIES --` marker.
3. **Rewrite the `retains at least one TODO(auth) comment` test in `lib/schema.test.ts`.** Replace it with three tests:
   - "declares `public.current_role()` helper" — regex `/create or replace function public\.current_role\(\)/i`.
   - "every user-facing table has at least one `create policy`" — loop `TABLE_NAMES`, assert regex `/create policy \w+ on (public\.)?<table>/i` matches.
   - "every `create policy` is preceded by a `drop policy if exists` for idempotency" — count occurrences; expect `createPolicyCount === dropPolicyCount`.
   - Keep the existing "enables row level security on every user-facing table" test — still valid.
4. **Create `scripts/apply-rls-policies.ts`.** Use Node `fs.readFileSync` with an absolute path derived from `path.resolve(__dirname, "../supabase/schema.sql")`. Extract between the markers with `String.prototype.split`. Print the preamble + SQL. Fail if markers missing.
5. **Add `db:rls` script to `package.json`.** `"db:rls": "tsx scripts/apply-rls-policies.ts"`. Confirm `tsx` is already a dev dependency (it's used by `seed-live-accounts.ts` and `smoke-check.ts` per the existing `scripts/` directory) — if not, escalate as an Open Question.
6. **Run the schema test suite.** `npm test -- lib/schema.test.ts` passes.
7. **Dry-run the apply script.** `npm run db:rls` prints a valid SQL block that starts with `create or replace function public.current_role()` and ends after the `messages` policies.
8. **Apply to live Supabase.** Manual: run `npm run db:rls`, copy the SQL, paste into the Supabase SQL Editor, execute. Verify no errors. Smoke-check a dispatcher session reads pickup_requests and a driver session reads only their own route.
9. **Update BUILD_LOG / SPEC cross-references.** Edit the one-line reference in `docs/plans/auth-skeleton.md` (if present) pointing to this file; add a note to BUILD_LOG.md that the TODO(auth) placeholders have been resolved. (Skip if the file doesn't have such a pointer — do not invent one.)

## Tests to write

- `lib/schema.test.ts` — three new assertions replacing the TODO-comment test (see step 3 above). File path: `/Users/abraham/lab-dispatch/lib/schema.test.ts`. Covers:
  - helper function is declared,
  - every user-facing table has `create policy`,
  - every `create policy` has a paired `drop policy if exists`.
- No new test files. No live-DB tests. Policy enforcement against real user JWTs is a manual verification step (see Implementation step 8).

## External services touched

- **Supabase Postgres** — schema change (helper function + policies). Applied manually via SQL Editor using output of `scripts/apply-rls-policies.ts`. No new wrapper interface — `interfaces/storage.real.ts` and `lib/supabase-server.ts` continue to use the existing clients.
- No other external services (SMS, email, Anthropic, Mapbox) touched.

## Open questions

1. **Is `tsx` already in devDependencies?** Existing `scripts/*.ts` files suggest yes, but we should confirm before adding `db:rls`. If not, either use `ts-node` (already present?) or fall back to `node --loader tsx/esm` — decide before step 5.
2. **Drivers updating routes/stops — column narrowing.** The plan grants drivers UPDATE on their own `routes` and `stops` rows, with column restrictions enforced only at the app layer. A stricter alternative is to drop those driver UPDATE policies and route all driver writes through a service-role admin API. Decision here affects the driver UI's direct-update pattern. Defaulting to permissive row-level + app-enforced column narrowing for v1, but flag for review.
3. **Pickup-form SELECT for unauthenticated users.** The public pickup form at `/pickup/[slug]/[token]` renders office info for an anonymous caller. Plan assumes this renders via a server route that uses the admin client (confirmed by reading `interfaces/storage.real.ts`'s `findOfficeBySlugToken`). If any future client-side path needs anon reads, a narrow `offices_select_anon_by_token` policy will be needed — flag only, do not add now.
4. **Automated policy verification.** Manual verification in step 8 is the v1 plan. A follow-up could add a `lib/supabase-server.test.ts`-style test that spins up a test DB with pgTAP or uses a second user JWT — explicitly deferred.

---

PLAN WRITTEN: docs/plans/rls-policies.md
Summary: Adds a `public.current_role()` SECURITY DEFINER helper plus per-table RLS policies for all 9 user-facing tables in `supabase/schema.sql` (idempotent, re-runnable), encoding the spec's visibility rules — drivers see only their own routes/stops via join-to-routes predicates, dispatchers see everything in the last 30 days, admins see everything. Service-role clients continue to bypass RLS, so `interfaces/storage.real.ts` and the admin API keep working unchanged; only the anon/user-session client (used by `getUserFromSession` and future direct-from-browser reads) is gated. A new `scripts/apply-rls-policies.ts` extracts the policies section between two markers and prints it for manual paste into the Supabase SQL Editor (deliberately avoiding a new `pg` dep for this one-time task). `lib/schema.test.ts` gains three assertions covering helper presence, per-table policy coverage, and `drop policy if exists` idempotency.
Open questions: 4
