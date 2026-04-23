# Plan: Real Supabase Postgres Adapter for StorageService

**Slug:** adapter-supabase-storage
**SPEC reference:** Tech stack (Supabase Postgres); unblocks every v1 feature IN that persists state — driver route view, dispatcher queue/map/assignment, pickup channels, admin CRUD. Builds on `interface-layer` (which defined the port, mock, and `NotConfiguredError` stub) and `db-schema` (which is the source of truth for column names/enums/constraints).
**Status:** draft

## Goal
Replace every `notConfigured()` stub in `createRealStorageService()` with a working Supabase-backed implementation using `@supabase/supabase-js` so the app can run against a real Postgres when `USE_MOCKS=false`, while preserving exact behavioral parity with `mocks/storage.ts` (same error messages, same soft-vs-hard delete semantics, same side effects) and keeping all tests hermetic (no real HTTP).

## Out of scope
- RLS policies. `schema.sql` already enables RLS on every table with a TODO; this adapter runs as the service role (bypasses RLS) and the actual policies land in the `rls-policies` feature.
- Supabase Auth (`supabase.auth.admin.createUser`, email+password seeding). The adapter's `createDriver` must persist a `drivers` row keyed by a caller-supplied `profileId` in a way that composes with the future auth adapter, but the auth-side user creation is deferred to the `adapter-supabase-auth` feature. Flagged in Open Questions.
- Seeding the three test accounts (`admin@test`, `dispatcher@test`, `driver@test`) into a real Supabase project. Deferred to `adapter-supabase-auth` — the mock's `driverAccounts` side map stays mock-only.
- Supabase Realtime subscriptions (dispatcher live-map updates). Deferred per BLOCKERS `[supabase]`.
- A migration framework. We continue running `supabase/schema.sql` manually in the Supabase SQL editor.
- The `seed*` / `getDriverAccount` test-only helpers exported from `mocks/storage.ts`. These are test-only artifacts and have no real-adapter equivalents.
- Connection pooling. `@supabase/supabase-js` uses stateless REST over `fetch`; nothing to pool.
- Generated Supabase TS types (`supabase gen types`). The adapter speaks the hand-written domain types in `lib/types.ts` and maps at the boundary via `lib/supabase-mappers.ts`.
- The `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser/client key). This adapter uses the service-role key exclusively and never runs in the browser; the anon client is the auth adapter's concern.

## Files to create or modify

### New files
- `/Users/abraham/lab-dispatch/interfaces/supabase-client.ts` — singleton `SupabaseClient` factory. Exports `getSupabaseAdminClient(): SupabaseClient`. Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; throws `NotConfiguredError` if either is missing. Memoized on `globalThis[Symbol.for("lab-dispatch.supabase-admin")]` so Next.js HMR and repeated calls share one client. First line: `import "server-only";` so webpack errors if this module is ever imported from a Client Component. Shared with the future auth adapter.
- `/Users/abraham/lab-dispatch/interfaces/supabase-client.test.ts` — verifies: (a) missing `NEXT_PUBLIC_SUPABASE_URL` throws `NotConfiguredError`; (b) missing `SUPABASE_SERVICE_ROLE_KEY` throws `NotConfiguredError`; (c) with both set, `getSupabaseAdminClient()` returns the same instance on repeated calls; (d) the thrown error's message does NOT include the key value. Uses `vi.mock("@supabase/supabase-js", ...)` + `vi.stubEnv` — no real HTTP. Note: the `server-only` import is stubbed via `vi.mock("server-only", () => ({}))` so Vitest can load the module under Node.
- `/Users/abraham/lab-dispatch/interfaces/storage.real.ts` — the real adapter. First line: `import "server-only";`. Exports `createRealStorageService(): StorageService`. Uses `getSupabaseAdminClient()` and the mappers. Every method is a thin composition of 1–3 supabase-js calls plus mapper translation and error wrapping.
- `/Users/abraham/lab-dispatch/interfaces/storage.real.test.ts` — exhaustive per-method tests against a hand-rolled fake client. Top of file: `vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => makeFakeSupabase()) }));` and `vi.mock("server-only", () => ({}))`. Covers every method listed in the `StorageService` interface plus the error-wrapping paths.
- `/Users/abraham/lab-dispatch/lib/supabase-mappers.ts` — pure functions converting DB rows (snake_case, nullable) to domain types (camelCase, optional) and back. One pair per table: `dbOfficeToOffice`/`officeToDbInsert`/`officePatchToDbUpdate`, `dbDriverToDriver`/`driverToDbInsert`/`driverPatchToDbUpdate`, `dbDoctorToDoctor`/`doctorToDbInsert`/`doctorPatchToDbUpdate`, `dbPickupRequestToPickupRequest`/`pickupRequestToDbInsert`/`pickupRequestPatchToDbUpdate`, `dbRouteToRoute`/`routeToDbInsert`/`routePatchToDbUpdate`, `dbStopToStop`/`stopToDbInsert`/`stopPatchToDbUpdate`, `dbDriverLocationToDriverLocation`/`driverLocationToDbInsert`, `dbMessageToMessage`/`messageToDbInsert`/`messagePatchToDbUpdate`. Also exports `wrapSupabaseError(err, context): Error` — formats `Error(\`${context}: ${err.code ?? "unknown"}\`)` without leaking keys or URLs.
- `/Users/abraham/lab-dispatch/lib/supabase-mappers.test.ts` — round-trips one representative row per mapper (db → domain → db-insert / domain → db-insert → db), confirms nullable DB columns (`phone`, `email`, `lat`, etc.) map to `undefined` (NOT `null`) on the domain side, confirms camelCase↔snake_case on every column, confirms `Office.address` is split into four `address_*` columns on insert and reassembled on read with empty-string fallback when all four are null. Also asserts `wrapSupabaseError` never includes the service-role key or URL even when the input `err` embeds them.
- `/Users/abraham/lab-dispatch/tests/helpers/fake-supabase.ts` — test helper `makeFakeSupabase()`. Returns an object shaped like the supabase-js `SupabaseClient` with a `from(tableName)` method that returns a query builder recording every call (`.select`, `.insert`, `.update`, `.delete`, `.eq`, `.in`, `.gte`, `.order`, `.limit`, `.single`, `.maybeSingle`, etc.) in `calls: Array<{ table, op, args }>`. Each builder method returns `this` so chains work. Terminal methods (`.single()`, `.maybeSingle()`, `.then(...)`, awaitable thenable) resolve with a canned response read from a per-table queue set up by the test via helpers like `client.__enqueue("offices", { data: [...], error: null })`. Also exposes `client.__rpc(fnName, handler)` for the one or two methods that need a DB-side transaction via an `rpc()` call. Written as TS only — no `any` on the public surface; internal builder can use `any` sparingly with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` if needed.
- `/Users/abraham/lab-dispatch/tests/helpers/fake-supabase.test.ts` — minimal sanity test for the helper itself (two chained calls round-trip through `calls`; canned response resolves; error response rejects). Keeps the helper honest.

### Modifications
- `/Users/abraham/lab-dispatch/interfaces/storage.ts` — remove the `notConfigured()` helper and the inline stub implementation of `createRealStorageService()`; instead, re-export from the new server-only file:
  ```ts
  export { createRealStorageService } from "./storage.real";
  ```
  The `StorageService` interface and all the `New*` / filter / summary types stay in `storage.ts` (importable from client code). This keeps the service-role client code in its own `"server-only"` module while callers continue to `import { StorageService } from "@/interfaces/storage"`.
- `/Users/abraham/lab-dispatch/interfaces/index.ts` — no shape change. `import { createRealStorageService } from "./storage"` continues to work via the re-export. Confirm `getServices()` under `USE_MOCKS=false` returns the new real implementation by wiring up a Supabase test project later; the existing `interfaces/index.test.ts` case for `"false"` still passes because the real adapter throws `NotConfiguredError` out of `getSupabaseAdminClient()` when env vars are missing (which is the case in the test environment).
- `/Users/abraham/lab-dispatch/interfaces/index.test.ts` — adjust the existing "throws `NotConfiguredError` when USE_MOCKS is 'false'" case only if the assertion on `envVar === "TWILIO_ACCOUNT_SID"` is unaffected (it is — that test calls `services.sms.sendSms`, not storage). **Additionally** extend the test file with one new case that calls `services.storage.listOffices()` under `USE_MOCKS=false` and asserts it rejects with `NotConfiguredError` whose `envVar` is `"NEXT_PUBLIC_SUPABASE_URL"`. This confirms the real storage path correctly reports the missing-env surface.
- `/Users/abraham/lab-dispatch/package.json` — add `"@supabase/supabase-js": "^2.45.0"` to `dependencies` (pin to `^2.45` — current stable). Run `npm install` so `package-lock.json` updates. No other package changes.
- `/Users/abraham/lab-dispatch/vitest.setup.ts` — add one line: `vi.mock("server-only", () => ({}))` at the top (inside the file but before `resetAllMocks` import-time runs), so every test file that transitively imports `storage.real.ts` or `supabase-client.ts` can load under Node/Vitest without the real `server-only` package throwing. If this turns out to collide with any other setup (unlikely — `server-only` is not imported elsewhere yet), fall back to per-file `vi.mock` instead. Prefer the global approach for uniformity.
- `/Users/abraham/lab-dispatch/BLOCKERS.md` — update the `[supabase]` entry's "Where it plugs in" line to note that the real adapter now lives in `interfaces/storage.real.ts` (alongside `interfaces/supabase-client.ts`) and that the adapter uses `SUPABASE_SERVICE_ROLE_KEY` server-side. Workaround description stays the same.
- `/Users/abraham/lab-dispatch/BUILD_LOG.md` — append one dated entry summarizing this feature: `@supabase/supabase-js` added, admin client singleton, `storage.real.ts` with 40+ methods wired, mappers module, fake-supabase test helper, per-method coverage in `storage.real.test.ts`. Reminder that tests stay hermetic via `vi.mock("@supabase/supabase-js")`.

## Interfaces / contracts

### `interfaces/supabase-client.ts`
```ts
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NotConfiguredError } from "@/lib/errors";

const GLOBAL_KEY = Symbol.for("lab-dispatch.supabase-admin");

export function getSupabaseAdminClient(): SupabaseClient {
  const cached = (globalThis as Record<symbol, unknown>)[GLOBAL_KEY];
  if (cached) return cached as SupabaseClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || url.length === 0) {
    throw new NotConfiguredError({
      service: "storage (Supabase)",
      envVar: "NEXT_PUBLIC_SUPABASE_URL",
    });
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.length === 0) {
    throw new NotConfiguredError({
      service: "storage (Supabase)",
      envVar: "SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  (globalThis as Record<symbol, unknown>)[GLOBAL_KEY] = client;
  return client;
}

/** Test-only: clears the memoized admin client. */
export function __resetSupabaseAdminClient(): void {
  delete (globalThis as Record<symbol, unknown>)[GLOBAL_KEY];
}
```
Guarantees:
- `NotConfiguredError.envVar` always names the FIRST missing variable (URL checked first, then key), so callers get a predictable surface.
- Throw message never embeds `url` or `key` values — `NotConfiguredError` already ignores them, but this is worth calling out in a comment.
- `__resetSupabaseAdminClient` is called from the `beforeEach` in `storage.real.test.ts` so each test gets a fresh fake client.

### `interfaces/storage.real.ts` (skeleton)
```ts
import "server-only";
import { getSupabaseAdminClient } from "./supabase-client";
import * as m from "@/lib/supabase-mappers";
import type { StorageService, /* …all the helper types… */ } from "./storage";

export function createRealStorageService(): StorageService {
  const sb = () => getSupabaseAdminClient(); // lazy — defer env checks until first call

  return {
    async listOffices() {
      const { data, error } = await sb()
        .from("offices")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw m.wrapSupabaseError(error, "listOffices");
      return (data ?? []).map(m.dbOfficeToOffice);
    },
    // …one method per interface member…
  };
}
```

Notes:
- `sb()` is invoked per-call, not captured at construction time, so a dev who imports `createRealStorageService()` before env vars load (rare but possible in Next.js edge cases) still gets the helpful error on first use instead of at module init.
- Every method has the shape: call supabase-js → check `error` → map rows → return. No business logic lives here — transitions like "stop arrived → set `arrived_at = now`" are computed in TS (not via SQL), mirroring the mock.

### `lib/supabase-mappers.ts` — representative examples
```ts
export interface DbOfficeRow {
  id: string;
  name: string;
  slug: string;
  pickup_url_token: string;
  phone: string | null;
  email: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  lat: number | null;
  lng: number | null;
  active: boolean;
  created_at: string;
}

export function dbOfficeToOffice(row: DbOfficeRow): Office {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    pickupUrlToken: row.pickup_url_token,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    address: {
      street: row.address_street ?? "",
      city: row.address_city ?? "",
      state: row.address_state ?? "",
      zip: row.address_zip ?? "",
    },
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    active: row.active,
  };
}

export function officeToDbInsert(input: NewOffice): Omit<DbOfficeRow, "id" | "created_at"> {
  return {
    name: input.name,
    slug: input.slug,
    pickup_url_token: input.pickupUrlToken,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address_street: input.address.street,
    address_city: input.address.city,
    address_state: input.address.state,
    address_zip: input.address.zip,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    active: input.active,
  };
}

export function officePatchToDbUpdate(patch: Partial<Omit<Office, "id">>): Partial<Omit<DbOfficeRow, "id" | "created_at">> {
  const out: Partial<Omit<DbOfficeRow, "id" | "created_at">> = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.slug !== undefined) out.slug = patch.slug;
  if (patch.pickupUrlToken !== undefined) out.pickup_url_token = patch.pickupUrlToken;
  if (patch.phone !== undefined) out.phone = patch.phone ?? null;
  if (patch.email !== undefined) out.email = patch.email ?? null;
  if (patch.address !== undefined) {
    out.address_street = patch.address.street;
    out.address_city = patch.address.city;
    out.address_state = patch.address.state;
    out.address_zip = patch.address.zip;
  }
  if (patch.lat !== undefined) out.lat = patch.lat ?? null;
  if (patch.lng !== undefined) out.lng = patch.lng ?? null;
  if (patch.active !== undefined) out.active = patch.active;
  return out;
}

export function wrapSupabaseError(
  err: { code?: string; message?: string; details?: string },
  context: string,
): Error {
  // Never include err.message verbatim — Supabase occasionally echoes request
  // metadata that can leak bearer tokens or URLs in rare failure modes.
  const code = err.code ?? "unknown";
  return new Error(`${context} failed (code=${code})`);
}
```

Every other table follows the same three-function pattern (`dbXToX`, `xToDbInsert`, `xPatchToDbUpdate`) with the enum values (`request_channel`, `request_status`, `route_status`, `user_role`) passed through as-is since the SQL enum values already match the TS string literals in `lib/types.ts`.

### `tests/helpers/fake-supabase.ts` — shape
```ts
type CannedResponse<T = unknown> = { data: T | null; error: null | { code?: string; message?: string } };

interface FakeSupabase {
  from(table: string): FakeQuery;
  __enqueue<T>(table: string, op: string, response: CannedResponse<T>): void;
  __calls(): Array<{ table: string; op: string; args: unknown[] }>;
  __reset(): void;
}

export function makeFakeSupabase(): FakeSupabase { /* ... */ }
```
The builder's `.select`, `.insert`, `.update`, `.delete`, `.eq`, `.neq`, `.in`, `.gte`, `.lte`, `.order`, `.limit`, `.single`, `.maybeSingle` all record into `calls` and return the builder; terminal `.then(onFulfilled, onRejected)` drains the first queued response for the current `(table, op)` pair (op = "select" | "insert" | "update" | "delete") and resolves with it.

## Implementation steps

1. **Install the SDK.** `npm install @supabase/supabase-js@^2.45.0`. Verify `package.json` and `package-lock.json` update cleanly. Then run `npm install server-only` (tiny Next.js-shipped helper that no-ops server-side and throws in the browser bundle).
2. **Write `interfaces/supabase-client.ts`.** Implement the singleton per the contract. Add `__resetSupabaseAdminClient` as a test-only named export (not in the interface).
3. **Write `interfaces/supabase-client.test.ts`.** Four cases: missing URL, missing key, both present → stable singleton, `NotConfiguredError.message` never contains the key value. Use `vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ __mockClient: true })) }))` and `vi.mock("server-only", () => ({}))` if the global stub in `vitest.setup.ts` hasn't landed yet. `beforeEach(__resetSupabaseAdminClient)`.
4. **Write `lib/supabase-mappers.ts`.** One `Db*Row` interface + one pair (or trio) of mapper functions per table:
   - `offices` (the address-split case above)
   - `drivers` — joins `profiles` for `full_name` + `phone`; details below in step 10
   - `doctors`
   - `pickup_requests`
   - `routes`
   - `stops`
   - `driver_locations` — note `id` is `bigserial`; mapper does `String(row.id)` per `DriverLocation.id: string` contract from `lib/types.ts`
   - `messages`
   Also implement `wrapSupabaseError(err, context)`.
5. **Write `lib/supabase-mappers.test.ts`.** One round-trip test per table (`db → domain → db-insert`) plus explicit coverage of: (a) null columns → `undefined` on the domain side, (b) `Office.address` split/reassemble, (c) `DriverLocation.id` stringification, (d) `wrapSupabaseError` output never contains a test input that includes the string `"service_role"` or a fake URL.
6. **Write `tests/helpers/fake-supabase.ts` + its sanity test.** Aim for a builder that handles every chain the adapter uses. Start with the minimum (`select`, `insert`, `update`, `delete`, `eq`, `order`, `single`, `maybeSingle`) and add methods as step 7 requires them.
7. **Add `vi.mock("server-only", () => ({}))` to `vitest.setup.ts`.** Verify the existing test suite (including `mocks/storage.test.ts` and `interfaces/index.test.ts`) still passes with no other changes. The stub is a no-op in tests; production code continues to get the real `server-only` guard from the installed package.
8. **Scaffold `interfaces/storage.real.ts`.** Start with the 9 original methods (`listOffices`, `listDrivers`, `listDoctors`, `listPickupRequests`, `createOffice`, `createDriver`, `createDoctor`, `createPickupRequest`, `updatePickupRequestStatus`). Get them green against the fake client before adding more. Update `interfaces/storage.ts` to re-export `createRealStorageService` from the new file and delete the inline stub + `notConfigured()` helper.
9. **Offices methods (full set).** Implement `listOffices` (select * order by name), `getOffice(id)` (select * eq id maybeSingle), `findOfficeBySlugToken(slug, token)` (select * eq slug eq pickup_url_token eq active maybeSingle — leverages the UNIQUE index on `slug`), `createOffice(input)` (insert + `.select().single()`), `updateOffice(id, patch)` (update + `.eq("id", id).select().single()`; if result is null throw `Error("office ${id} not found")`), `findOfficeByPhone(phone)` (normalize via `normalizeUsPhone` from `@/lib/phone`, then `.eq("phone", normalized).eq("active", true).maybeSingle()` — if that fails because stored phones have varied formatting, fall back to a full-scan `select * where active = true` and filter client-side via `normalizeUsPhone` to preserve mock semantics. Document the trade-off inline and flag for the indexing pass), `findOfficeByEmail(email)` (server-side `.ilike("email", email.trim())` with `.eq("active", true).maybeSingle()`; case-insensitive matches the mock's `.toLowerCase()` comparison).
10. **Drivers methods.** Key subtlety: `Driver.fullName` and `Driver.phone` live in `profiles`, while `Driver.vehicleLabel`, `active`, `createdAt` live in `drivers`. Every driver read is a join. Implement:
    - `listDrivers()` — `sb().from("drivers").select("*, profiles(full_name, phone)")` with an order by `created_at` ascending. Mapper `dbDriverToDriver` pulls `profiles.full_name` and `profiles.phone` into the domain type.
    - `getDriver(profileId)` — same select with `.eq("profile_id", profileId).maybeSingle()`.
    - `createDriver(input)` — **open question flagged**: the mock generates a `profileId` via `crypto.randomUUID()` and stashes a mock-only email+password. The real flow requires `supabase.auth.admin.createUser({ email, password })` → insert matching `profiles` row → insert `drivers` row, ideally in a transaction. This adapter's `createDriver` implementation plan is: (1) accept the `NewDriver` input unchanged, (2) in this feature, throw `NotConfiguredError({ service: "driver creation (auth not wired)", envVar: "SUPABASE_SERVICE_ROLE_KEY" })` from `createDriver` specifically with a comment pointing at the auth-adapter feature, OR (2') implement a temporary path that creates only the `profiles` + `drivers` rows using a caller-provided `profileId` (not possible with the current `NewDriver` type — `profileId` is `Omit`'d from the input). Preferred resolution: this feature ships with `createDriver` still throwing a scoped `Error("createDriver requires the Supabase auth adapter — see docs/plans/adapter-supabase-auth.md")`, and the auth adapter feature replaces it with the full 3-step insert inside a single `sb.rpc("create_driver_with_profile", { email, full_name, phone, vehicle_label })` Postgres function (to be authored with RLS policies). **This keeps the rest of the adapter fully functional.** Document in the method comment. Tests for `createDriver` under the real adapter assert this scoped error.
    - `updateDriver(profileId, patch)` — split the patch: `full_name`/`phone` go to `profiles`, the rest to `drivers`. Two `update` calls; if the `profiles` patch is empty, skip it (and vice versa). Return the re-joined row. Throws `Error("driver ${profileId} not found")` if the `drivers` update returns no row.
    - `listDriverAccounts()` — `sb().from("drivers").select("profile_id, profiles(email)")` joined through `profiles.email` (which itself joins `auth.users` — confirm the `profiles` table has an `email` column. Looking at `schema.sql`, the `profiles` row does NOT currently include an `email` column; `auth.users.email` is the source of truth). Resolution: this method is a join through `auth.users` which is only safely readable with the service role. Implementation: `sb().from("drivers").select("profile_id").then(...)` → then `sb().auth.admin.listUsers()` → map. OR add an `email` column to `profiles` synced via trigger (that's a schema.sql change and probably belongs to the auth feature). **Plan:** implement `listDriverAccounts` via `sb.auth.admin.listUsers()` filtered to the `profile_id`s that have a `drivers` row. This keeps schema.sql untouched. Flagged as Open Question #2.
11. **Doctors methods.** `listDoctors`, `getDoctor`, `createDoctor`, `updateDoctor`, `deleteDoctor`. `deleteDoctor` is a hard delete (matches the mock). `updateDoctor`/`deleteDoctor` throw `Error("doctor ${id} not found")` when `.eq("id", id)` affects zero rows — detect via `.select("id").maybeSingle()` chained after the mutation to confirm the row existed, or run a pre-check `getDoctor(id)` first. Prefer the post-check with `.select()` to keep it to one round-trip. `listDoctors` orders by `name` ascending.
12. **Pickup requests methods.** `listPickupRequests({ status })` — optional `.eq("status", status)`, always `.order("created_at", { ascending: false })`. `getPickupRequest(id)` — `eq("id", id).maybeSingle()`. `createPickupRequest(input)` — defaults `status = "pending"`, returns inserted row. `updatePickupRequestStatus(id, status, flaggedReason)` — compute `flagged_reason`: when `status === "flagged"`, preserve or overwrite with the supplied reason (requires a read-then-write since the patch depends on current value — one `select` + one `update`); when any other status, set to `null`. Sets `updated_at = new Date().toISOString()` (the schema has a default for inserts but not updates). Throws `Error("pickup request ${id} not found")` on miss.
13. **Routes methods.** `listRoutes({ date, driverId, status })` — build the query by chaining `.eq` only for provided filters; always `.order("created_at", { ascending: true })`. `getRoute(id)` — `eq("id", id).maybeSingle()`. `createRoute({ driverId, routeDate })` — insert with `status = "pending"`, return row. `updateRouteStatus(id, status)` — read current, compute transitions matching the mock (`pending→active` sets `started_at = now` if null, `active→completed` sets `completed_at = now` if null, `anything→pending` clears both), write, return updated. Throws `Error("route ${id} not found")` on miss.
14. **Stops methods.** `listStops(routeId)` — `eq("route_id", routeId).order("position", { ascending: true })`. `assignRequestToRoute(routeId, pickupRequestId, position?)` — this is the compound operation:
    1. `getRoute(routeId)` and `getPickupRequest(pickupRequestId)` — if either missing, throw the matching `"not found"` error.
    2. Check for existing stop for this `pickup_request_id` via `.from("stops").select("id").eq("pickup_request_id", pickupRequestId).maybeSingle()`; if present, throw `Error("pickup request already assigned")`. This matches the mock's invariant and is also enforced by the `unique (route_id, pickup_request_id)` constraint — we pre-check for a nicer error.
    3. Compute `nextPosition`: if `position` param provided, pre-check `.from("stops").select("id").eq("route_id", routeId).eq("position", position).maybeSingle()`; if row exists, throw `Error("stop at position ${position} already exists")`. Otherwise query max position and add 1 (`.from("stops").select("position").eq("route_id", routeId).order("position", { ascending: false }).limit(1).maybeSingle()`).
    4. Insert stop row.
    5. Update pickup_request `status = "assigned"`, `updated_at = now`.
    6. Return the mapped Stop.
    Note: this is multiple round-trips and not atomic. The UNIQUE constraint on `(route_id, position)` and `(route_id, pickup_request_id)` ensures safety if two writers race — either will get a Postgres error that we wrap. Acceptable for v1.
    `removeStopFromRoute(stopId)` — same multi-step: read stop (throws `"stop ${stopId} not found"`), delete, re-number survivors via N `update` calls (Postgres has no cheap bulk re-number without RPC; each survivor gets its own `.update({ position: idx+1 }).eq("id", stop.id)`), update pickup_request back to `"pending"` with `flagged_reason = null`. Document the round-trip cost.
    `reorderStops(routeId, orderedStopIds)` — verify count and membership via one `listStops` call; then N `update` calls (one per stop). Throws per the mock's exact messages.
    `getStop(id)` — `eq("id", id).maybeSingle()`.
    `markStopArrived(stopId)` — read stop (throws not-found), if `arrivedAt` set throw `"already arrived"`, otherwise `update({ arrived_at: now }).eq("id", stopId).select().single()`. Same pattern for `markStopPickedUp` (check `arrivedAt` set + `pickedUpAt` unset) and `markStopNotified10min` (idempotent — if already true, return the existing row without a write). `updateStopEta(stopId, etaAtIso)` — simple update.
15. **Driver locations methods.** `recordDriverLocation(input)` — insert row, return mapped row with `id` stringified. `listDriverLocations({ sinceMinutes = 15 })` — `.gte("recorded_at", cutoffIso).order("recorded_at", { ascending: false })`, then client-side dedupe to "latest per driver" (the mock already does this client-side; SQL `distinct on (driver_id)` would require raw RPC — acceptable to dedupe in TS since the cutoff bounds the row count).
16. **Messages methods.** `listMessages({ flagged })` — when `flagged === true`, select messages where `pickup_request_id is null` OR the linked pickup request has `status = 'flagged'`. Implement via a Postgres `or` filter: `.from("messages").select("*, pickup_requests(status)").or(\`pickup_request_id.is.null,pickup_requests.status.eq.flagged\`)`. Always `.order("received_at", { ascending: false })`. `createMessage(input)` — insert, return row. `linkMessageToRequest(messageId, pickupRequestId)` — read message (throws not-found), if `pickupRequestId` already set and differs, throw `"message already linked"`; otherwise idempotently update. `createRequestFromMessage(messageId)` — read message (throws if not found or already linked), insert a new pickup_request (seeded per the mock's field rules: `channel`, `urgency: "routine"`, `source_identifier`, `raw_message`, `status: "pending"`), then update message with `pickup_request_id`, return the new request.
17. **Dashboard counts.** `countAdminDashboard()` — four `.from(table).select("*", { count: "exact", head: true })` calls in parallel via `Promise.all`, plus `.eq("status", "pending")` on the pickup requests count. Map `count` from the response (it's on the response object alongside `data`). `countDispatcherDashboard(dateIso?)` — similar parallel: `pending_requests` (status = pending), `today_stops` (join routes where route_date = date, count stops), `active_routes` (status = active), `flagged_messages` (same `or` filter as `listMessages({ flagged: true })` with `head: true` + `count: "exact"`). Use `dateIso ?? todayIso()` from `@/lib/dates`.
18. **`interfaces/storage.real.test.ts`.** Top of file: `vi.mock("@supabase/supabase-js")` and `vi.mock("server-only", () => ({}))`. In `beforeEach`, call `__resetSupabaseAdminClient`, set env vars via `vi.stubEnv`, and create a fresh `fakeClient = makeFakeSupabase()`. Write one or more `it(...)` per interface method. For each, enqueue the canned response(s) the adapter expects, call the method, assert: (a) the returned domain value, (b) `fakeClient.__calls()` recorded the expected sequence (`.from("offices").select("*").order("name", ...)` etc.), (c) for error paths, the adapter rejects with the expected `Error("... not found")` / etc. Also one test per method family asserting `wrapSupabaseError` is invoked when the client returns `{ error: { code: "..." } }`. For `createDriver`, assert it rejects with the scoped "requires auth adapter" error. For `listDriverAccounts`, assert it calls `auth.admin.listUsers()` + filters correctly.
19. **Extend `interfaces/index.test.ts`.** Add one `it("throws NotConfiguredError from real storage when USE_MOCKS='false' and Supabase env is missing", async () => { ... })`. Use `vi.stubEnv` to set `USE_MOCKS=false` and NOT set `NEXT_PUBLIC_SUPABASE_URL`. Call `getServices().storage.listOffices()` and assert the rejection is `NotConfiguredError` with `envVar === "NEXT_PUBLIC_SUPABASE_URL"`. Requires `vi.mock("server-only", () => ({}))` (either via `vitest.setup.ts` or file-local).
20. **Re-run the full suite.** `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. The existing 200+ tests must still pass (they all hit the mock path). The new test files must pass. `build` must still complete — the `"use server-only"` import means `storage.real.ts` and `supabase-client.ts` cannot be imported from Client Components; `next build` will surface any such violations.
21. **BLOCKERS.md + BUILD_LOG.md updates.** Per "Modifications" list. BLOCKERS stays mostly intact; only the file-path pointer changes and the `[supabase]` workaround note acknowledges the adapter is half-wired (storage done, auth+createDriver pending).

## Tests to write
- `/Users/abraham/lab-dispatch/interfaces/supabase-client.test.ts` — env-var guarding; singleton behavior; error message does not leak key.
- `/Users/abraham/lab-dispatch/lib/supabase-mappers.test.ts` — per-table round-trips, null→undefined, address split/reassemble, `DriverLocation.id` stringification, `wrapSupabaseError` never leaks inputs.
- `/Users/abraham/lab-dispatch/tests/helpers/fake-supabase.test.ts` — fake client records calls, resolves canned data, resolves canned errors, chain methods return `this`.
- `/Users/abraham/lab-dispatch/interfaces/storage.real.test.ts` — one or more per-method tests covering every `StorageService` member against the fake client. Error paths covered (not-found throws, `wrapSupabaseError` invocation, `createDriver` scoped error). No real HTTP.
- `/Users/abraham/lab-dispatch/interfaces/index.test.ts` — new case: `USE_MOCKS=false` + missing `NEXT_PUBLIC_SUPABASE_URL` → `listOffices()` throws `NotConfiguredError`.

## External services touched
- **Storage — Supabase Postgres.** Wrapped by `interfaces/storage.real.ts` (new) + `interfaces/storage.ts` (interface + re-export). Shared client factory `interfaces/supabase-client.ts`. Service-role key reads/writes bypass RLS (RLS policies are a separate feature). No other external service is added; mocks for SMS/email/maps/AI/auth remain unchanged.

## Open questions
1. **`createDriver` depends on the auth adapter.** Full driver creation requires `supabase.auth.admin.createUser` + `profiles` insert + `drivers` insert. This feature ships `createDriver` as a scoped throw pointing at the auth adapter feature; every other method is fully wired. Confirm that's acceptable or flag if the orchestrator wants a Postgres RPC function authored in this feature to ship full driver creation today. **Proposed resolution:** defer; unblocks immediately with auth adapter.
2. **`listDriverAccounts` joins `auth.users.email`.** The `profiles` table in `schema.sql` has no `email` column; emails live in `auth.users`. Two options: (a) call `sb.auth.admin.listUsers()` and filter client-side (this feature), or (b) add `profiles.email` + a trigger syncing from `auth.users` (schema change, belongs to auth adapter). **Plan uses (a)** to avoid schema changes here. Flagged so the auth adapter can decide to move to (b) later.
3. **Non-atomic multi-step operations.** `assignRequestToRoute`, `removeStopFromRoute`, `reorderStops`, `createRequestFromMessage`, `updatePickupRequestStatus` (with `flagged_reason` preservation) all do multiple round-trips. Postgres UNIQUE constraints provide safety on the critical ones (stop position, stop-per-request), but concurrent writers can still produce partially-applied states (e.g. a stop inserted but the pickup request not flipped to `assigned`). v1 accepts this; a follow-up feature can move compound ops to SQL functions / RPCs. Flagging so it isn't forgotten.
4. **`findOfficeByPhone` phone-normalization mismatch.** The mock re-normalizes stored phones via `normalizeUsPhone` before compare; Postgres `.eq("phone", normalized)` only matches exact stored strings. Plan uses `.eq` on normalized input first and falls back to a full-table scan on inactive-aware-filtered results. That works for the expected v1 data volume (~100 offices) but won't scale; flagging for a future functional-index migration.
5. **`vi.mock("server-only")` global.** Adding it to `vitest.setup.ts` affects every test. Alternative: mock per-file. The plan chooses global for uniformity and because no test today imports `server-only` directly. Flagging for reviewer sign-off.
