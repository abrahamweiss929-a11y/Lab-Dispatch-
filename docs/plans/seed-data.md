# Plan: Seed Data for Mock Demo

**Slug:** seed-data
**SPEC reference:** This touches every v1-IN surface (offices/doctors/drivers, three pickup channels, routes + stops + live tracking, inbound messages). It does not implement any new feature — it pre-fills the in-memory mock so the running Next.js app boots into a believable, navigable demo rather than empty screens.
**Status:** draft

## Goal
Ship a single `seedMocks()` entry point plus a small auto-seed hook in `getServices()` so that `pnpm dev` (USE_MOCKS=true) lands every role — driver, dispatcher, admin — on screens with realistic data: 6 offices, 10 doctors, 3 drivers, 20 pickup requests across all four channels and all four statuses, 5 inbound messages, 2 routes for today, and a trail of driver GPS pings. Tests stay pristine (seed is NEVER called during `NODE_ENV=test`).

## Out of scope
- Real Supabase seed SQL. A future migration plan can derive one from `mocks/seed.ts`, but this plan produces only the mock-layer seeder.
- Dev-time re-seed UI (button, admin toggle, route) — one process-lifetime seed is enough for v1 demo.
- Anonymization / PII scrubbing — every name, email, and phone is hand-picked fake data.
- Refactoring `mocks/storage.ts` — the seeder uses the existing public `storageMock.*` methods plus the exported `seedRoute` / `seedStop` / `seedDriverLocation` / `seedMessage` helpers. No storage API changes.
- Seed auth accounts — the 3 fixed accounts in `mocks/auth.ts` already exist; we only need to make sure the seeded drivers' `profileId` aligns with `user-driver` for the `driver@test` login flow (see Open Questions).
- Changing `resetAllMocks()` semantics — it stays a pure clear. Re-seeding after reset is the caller's responsibility (and in practice, nobody re-seeds after reset, because reset is only hit in tests).

## Files to create or modify

- **`mocks/seed.ts`** (new) — exports `seedMocks()`, `isSeeded()`, `resetSeedFlag()`. Holds the hand-authored fixture data (offices, doctors, drivers, pickup requests, messages, routes, stops, driver locations). Idempotent via a module-level `hasSeeded` flag.
- **`mocks/seed.test.ts`** (new) — vitest that calls `resetAllMocks()` + `resetSeedFlag()` + `seedMocks()` and asserts counts, distributions (channel/status/urgency), and shape invariants.
- **`interfaces/index.ts`** (modify) — wrap the mock branch of `getServices()` with a `maybeAutoSeed()` call that runs at most once per process, gated on env (see "Implementation steps" #4 for the exact gate).
- **`interfaces/index.test.ts`** (modify) — add a case that proves `getServices()` under `NODE_ENV=test` does NOT populate storage (counts stay 0 after the call).
- **`mocks/README.md`** (modify if present, otherwise skip — do not create) — one paragraph documenting `SEED_MOCKS` env var and the auto-seed gate. Skip if the README does not already exist; don't proactively create docs.

## Interfaces / contracts

New functions exported from `mocks/seed.ts`:

```ts
/**
 * Populates the mock storage with demo fixtures. Idempotent: second
 * and subsequent calls no-op until `resetSeedFlag()` is called.
 * Safe to call on already-populated storage only when `hasSeeded`
 * is true — if storage was cleared externally (e.g. resetAllMocks
 * in a test) WITHOUT resetting the flag, this will silently skip
 * re-seeding. Callers that need to re-seed after a reset must call
 * `resetSeedFlag()` first.
 */
export function seedMocks(): void;

/** Returns true after `seedMocks()` has run at least once this process. */
export function isSeeded(): boolean;

/** Clears the internal "already seeded" flag. Test-only. */
export function resetSeedFlag(): void;
```

New internal helper (not exported) in `interfaces/index.ts`:

```ts
function maybeAutoSeed(): void {
  // Runs at most once per process.
  // Gated on:
  //   - process.env.NODE_ENV !== "test"         (keep tests clean)
  //   - process.env.SEED_MOCKS !== "false"       (opt-out escape hatch)
  //   - !isSeeded()                              (idempotent)
  // Catches + swallows any seed error with console.warn — a broken
  // seeder must NOT prevent the app from booting.
}
```

No new types needed — every fixture is a literal of an existing `lib/types.ts` shape.

## Data shape (the 20 pickup requests at a glance)

Concrete distribution (matches the scope bullets; written out so the builder can copy it):

| channel | count | statuses                                         | urgencies                       | notes                                                                                                               |
|---------|-------|--------------------------------------------------|---------------------------------|---------------------------------------------------------------------------------------------------------------------|
| web     | 8     | 3 pending, 3 assigned, 1 completed, 1 flagged    | 5 routine, 2 urgent, 1 stat     | All 8 have an `officeId`. Mix of recent (today) and older (spread across last 30 days) `createdAt`.                 |
| sms     | 6     | 3 pending, 2 assigned, 1 completed               | 5 routine, 1 urgent             | 4 have parsed urgency + sampleCount; 2 have neither (raw message only — simulates AI low-confidence).               |
| email   | 4     | 1 pending, 1 assigned, 1 completed, 1 flagged    | 3 routine, 1 stat               | All 4 populate `sourceIdentifier` (the sender email). 1 has no `officeId` (orphaned parse).                         |
| manual  | 2     | 1 pending, 1 completed                           | 1 routine, 1 urgent             | Dispatcher-entered. `officeId` set; `sourceIdentifier` unset.                                                       |
| **total**| **20**| **8 pending / 6 assigned / 4 completed / 2 flagged** | **14 routine / 4 urgent / 2 stat** | **~7 with no sampleCount; 13 with 1-10.**                                                                           |

Sample-count distribution: 7 undefined, 13 with integer values chosen from {1,2,2,3,3,4,4,5,5,6,7,8,10}.

Timestamp spread: 4 requests created today, 6 within the last 3 days, 6 within the last 14 days, 4 within 15-30 days. Use a fixed reference date inside the seeder (`new Date()` at call time, minus N hours/days) — seed is not snapshot-stable across days, but that is fine; we only need stable WITHIN a run.

## The 6 offices (hand-picked fixtures)

Chicago-area metro for coherent lat/lng. Use 12-char hand-picked tokens for deterministic pickup URLs.

| # | name                          | slug              | token          | phone            | email                      | active | lat/lng         |
|---|-------------------------------|-------------------|----------------|------------------|----------------------------|--------|-----------------|
| 1 | Lincoln Park Pediatrics       | lincoln-park-ped  | a1b2c3d4e5f6   | +13125550101     | front@lincolnparkped.test  | true   | 41.9214,-87.6513|
| 2 | Near North Family Medicine    | near-north-fam    | b2c3d4e5f6a1   | +13125550102     | office@nnfm.test           | true   | 41.8998,-87.6347|
| 3 | West Loop Internal Medicine   | west-loop-im      | c3d4e5f6a1b2   | +13125550103     | hello@wlim.test            | true   | 41.8827,-87.6593|
| 4 | Logan Square Cardiology       | logan-sq-cardio   | d4e5f6a1b2c3   | **(omitted)**    | office@lscardio.test       | true   | 41.9291,-87.7085|
| 5 | Evanston Labs Associates      | evanston-labs     | e5f6a1b2c3d4   | +18475550105     | labs@evanstonassoc.test    | true   | 42.0451,-87.6877|
| 6 | Oak Park Internists (closed)  | oak-park-int      | f6a1b2c3d4e5   | +17085550106     | contact@opint.test         | **false**| 41.8850,-87.7845|

Office #4 covers the phoneless heads-up branch. Office #6 is soft-deleted to exercise `active=false` filtering in `findOfficeBySlugToken` / `findOfficeByPhone` / `findOfficeByEmail`.

## The 10 doctors

Distributed over the 5 active offices (skip office #6 — inactive offices should have no current doctors, simpler demo signal):

- Office 1 (Lincoln Park Pediatrics): 3 doctors — Dr. Amy Chen, Dr. Marcus Patel, Dr. Sofia Reyes.
- Office 2 (Near North Family): 2 doctors — Dr. Jamal Okafor, Dr. Hannah Weiss.
- Office 3 (West Loop IM): 2 doctors — Dr. Daniel Brooks, Dr. Priya Shah.
- Office 4 (Logan Sq Cardio): 1 doctor — Dr. Evelyn Torres.
- Office 5 (Evanston Labs): 2 doctors — Dr. Kenji Watanabe, Dr. Ruth Feldman.

Each has a `phone` and `email` (fake `.test` TLD). Phones use `+1312555` or `+1847555` prefixes matching their office area code.

## The 3 drivers

Created via `storageMock.createDriver()` so the side-map `driverAccounts` also gets populated:

1. `{ fullName: "Miguel Ortega", email: "miguel@lab.test", phone: "+13125559001", vehicleLabel: "Van 1 (white Transit)", active: true }` — will be the driver on today's active route.
2. `{ fullName: "Alicia Brooks", email: "alicia@lab.test", phone: "+13125559002", vehicleLabel: "Van 2 (blue Sprinter)", active: true }` — driver on today's pending route.
3. `{ fullName: "Terrance Wells", email: "terrance@lab.test", phone: "+13125559003", vehicleLabel: "Van 3 (retired)", active: false }` — soft-deleted, no route.

## The 5 inbound messages

- 3 parsed + linked to pickup requests (pick 3 of the sms/email pickup requests above and set `message.pickupRequestId` to match; requires creating the messages AFTER the requests and using `linkMessageToRequest`).
- 2 orphans for dispatcher triage:
  - SMS from an unknown phone (`+16305554444`) — `"Pickup tomorrow at 9? Thx"`.
  - Email from an unknown sender (`noreply@someclinic.test`) — subject `"Pickup request"`, body `"Hi, can we get a pickup Thursday?"`.

## The 2 routes for today

- **Route A** — Miguel Ortega, status `"active"`, `startedAt` = 90 min ago. 5 stops pulled from the 6 "assigned" pickup requests (leave 1 unassigned for demo variety). First 2 stops have `arrivedAt` + `pickedUpAt` set (completed), stop 3 has `arrivedAt` only (on-site), stops 4 and 5 are upcoming. `notified10min` = true on stops 1-3, false on 4-5.
- **Route B** — Alicia Brooks, status `"pending"`. 3 stops. Nothing checked in. All `notified10min = false`.

(6 assigned requests → 5 on Route A + 3 on Route B = 8 total stops; we need 8 assigned requests to fill both routes, so bump the "assigned" count above to 8 across all channels. Re-balance: web 4 assigned, sms 3 assigned, email 1 assigned = 8. Updated the table implicitly — builder must match totals: 6 pending + 8 assigned + 4 completed + 2 flagged = 20.)

**Corrected distribution** (this supersedes the earlier table where it conflicts):
- statuses: 6 pending, 8 assigned, 4 completed, 2 flagged (sum 20).
- Each assigned request is linked to exactly one stop on Route A or Route B.

## Driver locations (5-10 GPS pings for Miguel)

Build a straight-ish path between the lat/lng of Route A's completed stop → in-progress stop → next upcoming stop. Space `recordedAt` every 90 seconds going back from now for ~10 pings (10 × 90s = 15 min, fits `listDriverLocations` default `sinceMinutes=15`). Each row: `driverId = miguelProfileId`, `routeId = routeA.id`, lat/lng along the path. Use `seedDriverLocation()` to write them directly (avoids hitting `recordDriverLocation` 10 times).

## Implementation steps

1. **Scaffold `mocks/seed.ts`** with a module-level `let hasSeeded = false;`, a `resetSeedFlag()` that clears it, an `isSeeded()` getter, and a `seedMocks()` that early-returns when `hasSeeded` is true. Also declare the shared reference date `const now = new Date()` inside `seedMocks()` — all relative timestamps are computed from it.
2. **Seed offices** — 6 `storageMock.createOffice()` calls with the table above. Capture returned ids into named locals (`officeLincoln`, `officeNearNorth`, …) so later code can reference them.
3. **Seed doctors** — 10 `storageMock.createDoctor()` calls using the office id locals, per the distribution table.
4. **Seed drivers** — 3 `storageMock.createDriver()` calls; capture each returned `profileId`. Miguel's profileId is the "active-route driver" throughout.
5. **Seed 20 pickup requests** — loop an array literal of 20 hand-authored `NewPickupRequest` records through `storageMock.createPickupRequest()`. Each record includes a computed `createdAt` override via a lightweight post-create `updatePickupRequestStatus` call only when we need a non-default status. Simpler: because `createPickupRequest` accepts a `status` field and writes its own `createdAt`, we cannot backdate with the existing API. **Decision:** accept "all requests dated now" in v1 — the demo value of a 30-day spread is low compared to the churn of adding a new storage method. Open Questions captures this. For statuses other than `"pending"`, pass `status` directly to `createPickupRequest` (the mock respects it).
6. **Seed 2 routes + 8 stops** — Route A via `seedRoute()` (so we can set `status: "active"` and `startedAt` directly), then 5 `seedStop()` calls with hand-set `position`, `arrivedAt`, `pickedUpAt`, `notified10min` fields. Same for Route B with 3 stops. Using `seedRoute` / `seedStop` (rather than `createRoute` + `assignRequestToRoute`) is deliberate — `assignRequestToRoute` also flips pickup-request status to `"assigned"`, which we have already set, AND doesn't let us backdate `createdAt` / `arrivedAt`. IMPORTANT: also manually ensure each assigned pickup request's status is `"assigned"` (done in step 5 already); double-check by snapshotting counts at end.
7. **Seed driver locations** — 10 `seedDriverLocation()` calls along Route A's path, `recordedAt` spaced 90s apart going backward from `now`. All tagged with Miguel's `driverId` and Route A's `routeId`.
8. **Seed 5 messages** — 2 orphans via `storageMock.createMessage()` (both have `pickupRequestId: undefined`). 3 linked: create with `createMessage()`, then call `storageMock.linkMessageToRequest(messageId, pickupRequestId)` pointing at 3 of the sms/email pickup-request ids captured in step 5.
9. **Set `hasSeeded = true`** at the end of `seedMocks()`.
10. **Write `mocks/seed.test.ts`** — `beforeEach(() => { resetAllMocks(); resetSeedFlag(); });` then cases:
    - `seedMocks() populates expected counts` — asserts `listOffices().length === 6`, `listDoctors().length === 10`, `listDrivers().length === 3`, `listPickupRequests().length === 20`, `listMessages().length === 5`, `listRoutes({ date: today }).length === 2`, `listStops(routeA.id).length === 5`, `listStops(routeB.id).length === 3`, `listDriverLocations({ sinceMinutes: 30 }).length >= 1` (returns at most one per driver; we only seed for Miguel).
    - `seedMocks() is idempotent` — call twice, assert counts unchanged (no doubling).
    - `seedMocks() sets channel distribution` — 8 web, 6 sms, 4 email, 2 manual.
    - `seedMocks() sets status distribution` — 6 pending, 8 assigned, 4 completed, 2 flagged.
    - `seedMocks() sets urgency distribution` — 14 routine, 4 urgent, 2 stat.
    - `seedMocks() seeds the phoneless office` — `listOffices().find(o => o.name === "Logan Square Cardiology")?.phone` is `undefined`.
    - `seedMocks() seeds one soft-deleted office and one soft-deleted driver` — counts of `active=false` rows both === 1.
    - `seedMocks() puts Route A on "active" with partial check-ins` — assert `getRoute(routeA.id).status === "active"`, assert 2 stops have `pickedUpAt`, 1 has `arrivedAt` but not `pickedUpAt`, 2 have neither.
    - `seedMocks() links 3 of 5 messages` — assert `listMessages()` has exactly 3 with `pickupRequestId !== undefined`.
11. **Wire auto-seed into `interfaces/index.ts`** — add `import { seedMocks, isSeeded } from "@/mocks/seed";` and a private `function maybeAutoSeed(): void` that returns early when `process.env.NODE_ENV === "test"` OR `process.env.SEED_MOCKS === "false"` OR `isSeeded()` is true. Call it inside the mock branch of `getServices()` BEFORE returning the services object. Wrap in `try/catch` that emits `console.warn` on failure so seed errors never break `getServices()`.
12. **Extend `interfaces/index.test.ts`** — add one `it("does not auto-seed under NODE_ENV=test", ...)` case. Test stubs `NODE_ENV=test` (vitest already sets this, but we make it explicit), calls `getServices()`, and asserts `storageMock.listOffices()` returns `[]`. Also add a positive-path unit: stub `NODE_ENV=development`, call `getServices()`, assert `listOffices().length === 6`. Requires calling `resetSeedFlag()` in the test's `beforeEach` so the module-level flag doesn't leak across cases. Import `resetSeedFlag` from `@/mocks/seed`.
13. **Sanity pass** — run `pnpm test` (or `pnpm vitest run`) to prove global `beforeEach(resetAllMocks)` doesn't destabilize seed counts (it shouldn't — `seed.test.ts` explicitly also calls `resetSeedFlag()` so each case starts from zero).

## Tests to write

- **`mocks/seed.test.ts`** — covers counts, idempotency, channel/status/urgency distributions, phoneless-office presence, soft-deleted rows, Route A mid-route state, and message-link count. Enumerated in step 10.
- **`interfaces/index.test.ts`** (extension, not a new file) — covers `NODE_ENV=test` suppresses auto-seed; `NODE_ENV=development` triggers it; `SEED_MOCKS=false` overrides even in dev.

## External services touched

None — the seeder writes only to in-memory mock storage. No SMS is sent, no email is dispatched, no Anthropic call is made, no Mapbox lookup is performed, no Supabase RPC is issued. The `maybeAutoSeed()` hook lives strictly inside the mock branch of `getServices()` and is skipped entirely when `USE_MOCKS=false`.

## Open questions

1. **Backdated `createdAt` on pickup requests.** The current `createPickupRequest` stamps `now` for `createdAt`. Spreading the 20 requests across the last 30 days (as the scope bullet asks for) would require either (a) a new test-only `seedPickupRequest(row)` helper in `mocks/storage.ts` similar to `seedRoute` / `seedStop`, or (b) accepting that all 20 requests are dated "now" in v1. The plan currently assumes (b) and flags this for the orchestrator. Recommendation: add `seedPickupRequest(row: PickupRequest)` alongside the existing seed helpers — trivial, one-line addition to storage, preserves the "spread across last 30 days" intent. If the orchestrator approves, bump step 5 to use it.
2. **Driver login coherence.** The seeded auth accounts (`driver@test` → `userId: "user-driver"`) are not linked to any of the 3 seeded driver rows — Miguel/Alicia/Terrance get randomly-generated `profileId`s. The `driver@test` session will log in successfully but resolve to no `Driver` row. Options: (a) change the seeded `driver@test` session's `userId` to match Miguel's `profileId` post-hoc (requires mutating the auth mock's `SEEDED_ACCOUNTS`, or adding a helper); (b) have `seedMocks()` stub a fourth driver row with `profileId: "user-driver"` and the name "Test Driver"; (c) leave the mismatch for a follow-up "driver session binding" plan. Recommendation: (b) — one extra driver row, zero risk to other flows, gives `/driver` a working demo path. If approved, bump step 4 to 4 drivers (not 3), and bump the seed test's expected driver count to 4 (the scope's "3 drivers" becomes "3 named demo drivers + 1 bound to the test session").
3. **Resetting the seed flag across hot reload.** Next.js dev mode may re-evaluate `mocks/seed.ts` on hot reload, resetting `hasSeeded` to `false` and re-seeding on top of the existing data (duplicating every row). Mitigation: anchor the flag on `globalThis` (e.g. `(globalThis as any).__labDispatchSeeded`) so it survives HMR. Recommend adopting this from the start — it's two lines and avoids a Heisenbug when a dispatcher refreshes mid-demo.
