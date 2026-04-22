# Plan: Supabase Postgres Schema SQL

**Slug:** db-schema
**SPEC reference:** Tech stack (Supabase Postgres). Foundation for all v1 features IN — account types (driver/dispatcher/admin), pickup request channels (SMS/email/web), live tracking (GPS pings), route assignment, admin CRUD. Aligns with the v1 domain sketch in `lib/types.ts`.
**Status:** draft

## Goal
Produce a single idempotent `supabase/schema.sql` file that defines every Postgres table, enum, index, and RLS-enabled marker needed to back the v1 feature set, ready to run against a fresh Supabase project. Ship alongside a lightweight Vitest "shape" test that parses the SQL as text and verifies the structural invariants the rest of v1 will depend on.

## Out of scope
- Seed data (doctor offices, sample drivers). That lands in the `seed-data` feature.
- Supabase Auth configuration (email templates, providers, redirect URLs). That lands in the `auth` feature.
- Actual RLS policies. This feature only ENABLES RLS and leaves a TODO comment per table; the auth feature writes real policies.
- Storage buckets. Not used in v1.
- Edge functions / database functions / triggers. Not needed for v1 domain.
- Supabase CLI migration scaffolding (`supabase/migrations/…`). v1 runs the schema as one SQL file the user pastes into the Supabase SQL editor; migrations tooling arrives if/when the schema starts evolving.
- Generated TypeScript types from the schema (`supabase gen types`). Later feature.
- Any TypeScript client / query helper code that reads from these tables. Those wrappers land in `lib/` with their owning feature.
- Changing `lib/types.ts`. Existing domain types stay as-is; where SQL columns are a superset (e.g. `profiles.role`, `pickup_requests.flagged_reason`), that is intentional — the DB is the source of truth going forward, and TS types will catch up as features land.

## Files to create or modify

### New files
- `/Users/abraham/lab-dispatch/supabase/schema.sql` — the single canonical DDL file. Idempotent where practical: `CREATE EXTENSION IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. Enums use a `DO $$ … EXCEPTION WHEN duplicate_object …` guard (Postgres `CREATE TYPE` has no `IF NOT EXISTS`). RLS `ENABLE` statements are naturally idempotent.
- `/Users/abraham/lab-dispatch/lib/schema.test.ts` — Vitest "shape" test that reads `supabase/schema.sql` from disk and asserts structural invariants (see Tests section). Pure text parsing; no database connection.

### Modifications
- None. `supabase/README.md` already documents the directory's purpose; no update needed for this feature.

## Interfaces / contracts

### SQL objects created by `supabase/schema.sql`

**Extensions**
- `pgcrypto` — for `gen_random_uuid()` in column defaults.

**Enums** (all in `public` schema)
- `user_role` — `'driver' | 'dispatcher' | 'admin'`
- `request_channel` — `'sms' | 'email' | 'web' | 'manual'` (the extra `manual` value supports dispatcher-entered requests; `lib/types.ts` `PickupChannel` can extend when that feature lands)
- `request_status` — `'pending' | 'assigned' | 'completed' | 'flagged'` (per scope; narrower than the `lib/types.ts` `PickupStatus` sketch — see note below)
- `route_status` — `'pending' | 'active' | 'completed'`

Note on status vocabulary divergence: the scope for this feature specifies `request_status` = pending/assigned/completed/flagged, while `lib/types.ts` currently sketches pending/scheduled/en_route/picked_up/cancelled/flagged. The SQL follows the scope of this feature (DB is authoritative). The `auth`/`driver`/`dispatcher` features can either add enum values via `ALTER TYPE ADD VALUE` or reconcile the TS side; tracked under Open Questions.

**Tables**

1. `profiles` — extends `auth.users`
   - `id uuid primary key references auth.users(id) on delete cascade`
   - `role user_role not null`
   - `full_name text not null`
   - `phone text`
   - `created_at timestamptz not null default now()`
   - `updated_at timestamptz not null default now()`

2. `offices`
   - `id uuid primary key default gen_random_uuid()`
   - `name text not null`
   - `slug text not null unique`
   - `pickup_url_token text not null unique`
   - `phone text`
   - `email text`
   - `address_street text`
   - `address_city text`
   - `address_state text` (2-letter US state)
   - `address_zip text`
   - `lat double precision`
   - `lng double precision`
   - `active boolean not null default true`
   - `created_at timestamptz not null default now()`

3. `doctors`
   - `id uuid primary key default gen_random_uuid()`
   - `office_id uuid not null references offices(id) on delete cascade`
   - `name text not null`
   - `phone text`
   - `email text`
   - `created_at timestamptz not null default now()`

4. `drivers` — extends `profiles` with driver-only fields. Separate table (not a view) so vehicle/active can be edited by admins without touching the shared `profiles` row; `profile_id` is both PK and FK so there is exactly one drivers row per driver profile.
   - `profile_id uuid primary key references profiles(id) on delete cascade`
   - `vehicle_label text` (free-form, e.g. "Van 3" or plate)
   - `active boolean not null default true`
   - `created_at timestamptz not null default now()`

5. `pickup_requests`
   - `id uuid primary key default gen_random_uuid()`
   - `office_id uuid references offices(id) on delete set null` (nullable: unknown-sender flagged requests may not resolve to an office)
   - `channel request_channel not null`
   - `source_identifier text` (phone number for SMS, email address for email, office_id string for web, dispatcher user id for manual)
   - `raw_message text` (original SMS/email body; null for web form submissions that went through the structured form)
   - `urgency text` (parsed by AI; stored as text so values like 'routine'/'urgent'/'stat' can expand without a migration)
   - `sample_count integer`
   - `special_instructions text`
   - `status request_status not null default 'pending'`
   - `flagged_reason text`
   - `created_at timestamptz not null default now()`
   - `updated_at timestamptz not null default now()`

6. `routes`
   - `id uuid primary key default gen_random_uuid()`
   - `driver_id uuid not null references profiles(id) on delete restrict` (references the profile; the driver-specific row lives in `drivers`)
   - `route_date date not null`
   - `status route_status not null default 'pending'`
   - `started_at timestamptz`
   - `completed_at timestamptz`
   - `created_at timestamptz not null default now()`

7. `stops`
   - `id uuid primary key default gen_random_uuid()`
   - `route_id uuid not null references routes(id) on delete cascade`
   - `pickup_request_id uuid not null references pickup_requests(id) on delete restrict`
   - `position integer not null` (1-indexed ordering within the route)
   - `eta_at timestamptz`
   - `arrived_at timestamptz`
   - `picked_up_at timestamptz`
   - `created_at timestamptz not null default now()`
   - `unique (route_id, pickup_request_id)` — a pickup appears at most once per route
   - `unique (route_id, position)` — positions are distinct within a route

8. `driver_locations`
   - `id bigserial primary key` (high-volume table; bigserial keeps inserts cheap)
   - `driver_id uuid not null references profiles(id) on delete cascade`
   - `route_id uuid references routes(id) on delete set null`
   - `lat double precision not null`
   - `lng double precision not null`
   - `recorded_at timestamptz not null default now()`

9. `messages`
   - `id uuid primary key default gen_random_uuid()`
   - `channel request_channel not null` (will be `'sms'` or `'email'` in practice)
   - `from_identifier text not null` (phone or email)
   - `subject text` (email only)
   - `body text not null`
   - `received_at timestamptz not null default now()`
   - `pickup_request_id uuid references pickup_requests(id) on delete set null` (linked once parsed; null until then or if unparseable)

**Indexes**
- `idx_pickup_requests_status_created_at` on `pickup_requests (status, created_at desc)`
- `idx_stops_route_id_position` on `stops (route_id, position)`
- `idx_driver_locations_driver_id_recorded_at` on `driver_locations (driver_id, recorded_at desc)`
- `idx_offices_slug` on `offices (slug)` (already unique, but an explicit index statement keeps the shape test straightforward and matches the scope's named requirement)
- `idx_routes_driver_id_route_date` on `routes (driver_id, route_date)` — bonus index; every driver view loads "my route for today", so this is a lookup covered by the scope's spirit. Kept because it costs nothing and the alternative is a seq scan on every driver load.
- `idx_messages_pickup_request_id` on `messages (pickup_request_id)` — bonus index for the dispatcher inbox joining messages to requests. Same rationale.

**RLS**
- `ENABLE ROW LEVEL SECURITY` on each of: `profiles`, `offices`, `doctors`, `drivers`, `pickup_requests`, `routes`, `stops`, `driver_locations`, `messages`.
- Above each `ENABLE` line, a comment: `-- TODO(auth): policies land with the auth feature; see docs/plans/auth.md`.
- No policies are created. With RLS enabled and no policies, authenticated clients will see zero rows until the auth feature ships — this is intentional and safe.

**Comments**
- `COMMENT ON TABLE offices IS '…';` and `COMMENT ON TABLE pickup_requests IS '…';` — two anchor tables so a dev browsing the DB in the Supabase UI sees what the system is at a glance.

### Functions exported from `@/lib/schema.test.ts`
None — test file only.

No API routes, no React components, no server actions in this feature.

## Implementation steps

1. Create `/Users/abraham/lab-dispatch/supabase/schema.sql`. Open the file with a short header comment block:
   - Line 1: `-- Lab Dispatch v1 schema.`
   - Line 2: `-- Idempotent. Run in Supabase SQL editor against a fresh project or re-run safely.`
   - Line 3: `-- RLS is enabled on every user-facing table with a policy TODO; real policies land with the auth feature.`
2. Add `CREATE EXTENSION IF NOT EXISTS pgcrypto;` immediately after the header.
3. Add the four enum types. Wrap each in a `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$;` block so reruns do not error. Order: `user_role`, `request_channel`, `request_status`, `route_status`.
4. Add `CREATE TABLE IF NOT EXISTS public.profiles (…)` with the columns listed above. Place it before any table that references it.
5. Add `CREATE TABLE IF NOT EXISTS public.offices (…)`.
6. Add `CREATE TABLE IF NOT EXISTS public.doctors (…)` with `office_id` FK to `offices`.
7. Add `CREATE TABLE IF NOT EXISTS public.drivers (…)` with `profile_id` PK+FK to `profiles`.
8. Add `CREATE TABLE IF NOT EXISTS public.pickup_requests (…)`.
9. Add `CREATE TABLE IF NOT EXISTS public.routes (…)` with `driver_id` FK to `profiles(id)`.
10. Add `CREATE TABLE IF NOT EXISTS public.stops (…)` including the two `UNIQUE` constraints.
11. Add `CREATE TABLE IF NOT EXISTS public.driver_locations (…)`.
12. Add `CREATE TABLE IF NOT EXISTS public.messages (…)` with its `pickup_request_id` FK.
13. Add all `CREATE INDEX IF NOT EXISTS …` statements in the order listed under Indexes.
14. Add the two `COMMENT ON TABLE …` statements (offices, pickup_requests).
15. Add the `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` block. For each of the nine user-facing tables, emit two lines: a `-- TODO(auth): …` comment followed by the `ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY;` statement. Keep these together at the end of the file so a reviewer sees the security posture in one block.
16. Create `/Users/abraham/lab-dispatch/lib/schema.test.ts` as a Vitest test that reads the SQL file via `readFileSync` from `path.resolve(__dirname, "../supabase/schema.sql")` with `utf8` encoding, then asserts the invariants listed under "Tests to write". Use case-insensitive regexes so whitespace and casing drift do not make the test brittle.
17. Run `npm run typecheck && npm run lint && npm run test`. The new test must appear in Vitest's run output and pass. No build step is affected (the SQL file is not bundled).
18. Optional smoke verification for the author (not part of the automated gate): paste `supabase/schema.sql` into the Supabase SQL editor of a scratch project; confirm it runs clean end-to-end; run it a second time to confirm idempotence (no errors, no duplicate objects). This step is documented here but not enforced by CI.

## Tests to write
- `/Users/abraham/lab-dispatch/lib/schema.test.ts` — Vitest "shape" test; one `describe("supabase/schema.sql")` with these `it` cases, each reading the file text once (hoisted into `beforeAll`):
  1. **File exists and is non-empty** — the file resolves, is longer than 500 bytes, and starts with the `-- Lab Dispatch v1 schema.` header.
  2. **Extension** — matches `/create extension if not exists pgcrypto/i`.
  3. **Enums** — for each of `user_role`, `request_channel`, `request_status`, `route_status`, asserts a `/create type (public\.)?<name> as enum/i` match exists.
  4. **Tables** — for each of `profiles`, `offices`, `doctors`, `drivers`, `pickup_requests`, `routes`, `stops`, `driver_locations`, `messages`, asserts `/create table if not exists (public\.)?<name>/i` matches.
  5. **Indexes (named)** — asserts the four required named indexes exist: `idx_pickup_requests_status_created_at`, `idx_stops_route_id_position`, `idx_driver_locations_driver_id_recorded_at`, `idx_offices_slug`. Each is checked by a `/create index if not exists <name>/i` regex.
  6. **RLS enabled on all user-facing tables** — for each of the nine tables listed in step 15, asserts `/alter table (public\.)?<name> enable row level security/i` matches.
  7. **RLS TODO comment present** — at least one line in the file matches `/--\s*TODO\(auth\)/i`, guarding against someone stripping the policy-reminder comments when real policies land.

The test file lives under `/Users/abraham/lab-dispatch/lib/` (not `tests/`) because it is a colocated unit test on the `supabase/` artifact, not a cross-module integration test. `lib/README.md` already states `lib/` holds helpers and domain types; a schema shape test is a close sibling. If reviewers prefer it under `tests/`, it is a one-line move — no other file references it.

## External services touched
Supabase Postgres, indirectly. This feature produces the SQL that will be executed once against a Supabase project by a human operator; no runtime code opens a connection. No SMS, email, Anthropic, or Mapbox integration.

## Open questions
1. **Status enum vocabulary mismatch with `lib/types.ts`.** The scope of this feature sets `request_status` to `pending/assigned/completed/flagged`; `lib/types.ts` sketches `pending/scheduled/en_route/picked_up/cancelled/flagged`. Plan: follow the scope (DB authoritative), record this in Open Questions, let a downstream feature either (a) extend the enum via `ALTER TYPE ADD VALUE` or (b) update `lib/types.ts` to match. Same situation for `route_status` (scope: `pending/active/completed`; TS sketch: `draft/assigned/active/completed`). No action required in this feature — just flagging.
2. **`request_channel` includes `manual`** for dispatcher-entered requests; `lib/types.ts` `PickupChannel` currently has only `sms/email/web`. Noted for reconciliation when the dispatcher features land.
3. **`urgency` stored as `text`, not an enum.** SPEC suggests routine/urgent/stat, but AI-parsed values are likely to drift and `ALTER TYPE ADD VALUE` is awkward. Stored as `text` with application-level validation; can be promoted to an enum later with a backfill migration if values stabilize. Confirm this trade-off is acceptable.
