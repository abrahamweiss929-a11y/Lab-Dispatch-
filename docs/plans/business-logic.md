# Plan: Business Logic — Request-to-Stop Conversion, Route Completion, 10-Minute Heads-Up, Permission Policy

**Slug:** business-logic
**SPEC reference:** "Live tracking" (GPS sampling, manual arrived/picked up); "Confirmation flow" ("When a driver is ~10 minutes from a stop, the doctor's office gets a heads-up text"); "v1 features IN — Driver route view + check-ins + GPS tracking" and "Dispatcher live map + request queue + route assignment"
**Status:** draft

## Goal
Codify the remaining v1 business rules that glue together existing plumbing: (1) an idempotent office SMS heads-up when a driver's GPS shows ~10 minutes out from the next pending stop, (2) auto-completion of a route when its final stop is picked up, (3) a small `lib/permissions.ts` module that centralizes the "who may edit a route" and "who may check in a stop" rules so server actions can delegate to pure functions, (4) ETA-on-assignment for a new stop when the preceding stop and target office both have coordinates, and (5) a single `convertRequestToStop({ routeId, requestId })` helper consolidating assignment + ETA + status transition for future reuse. All logic is mock-backed, tested, and routed through the `StorageService` / `MapsService` / `SmsService` interfaces — no real network calls.

## Out of scope
- Automatic request-to-driver routing / automatic route optimization. Explicitly listed under "v1 features OUT" in SPEC.md — dispatcher still assigns manually.
- Surge-capacity / load-balancing logic (e.g. "driver X has 12 stops, route the next one to driver Y").
- Anti-replay / anti-spoofing for GPS pings. We trust whatever `recordLocationAction` accepted; the heads-up uses the same freshly-persisted coordinate.
- Real Twilio or Mapbox calls. `SmsService` and `MapsService` are invoked through the interface; the mocks satisfy behavior assertions.
- Retry / backoff / rate-limit for the heads-up SMS. Mock send is synchronous and cannot fail in the mock; the feature catches unknown errors silently to prevent GPS ingestion from failing. Real-adapter retry lands with the Twilio integration.
- Localization of the heads-up SMS copy. SPEC is English-only v1.
- Admin "impersonate driver for check-in" path. Permissions module explicitly forbids it; admin may view driver pages but not generate check-in rows (matches existing `requireDriverSession` contract).
- Push notifications or email heads-up. Only SMS, and only when `office.phone` is present.
- Per-tenant heads-up threshold customization. Hard-coded at 12 minutes (see "Open questions" for the exact threshold rationale).
- Driver-side "ETA on arrival" UI. This plan writes `stop.etaAt` but does not change any pages to render it — that's a future UI polish pass.
- Timezone-aware "today's route" logic beyond what `getTodaysRouteForDriver` already provides (UTC default).

## Files to create or modify

### New: 10-minute heads-up module
- `/Users/abraham/lab-dispatch/lib/heads-up.ts` — pure logic module exporting `maybeNotifyOffice({ driverId, lat, lng, routeId }): Promise<HeadsUpOutcome>`. Not a server action; called from `recordLocationAction` after the location row is persisted. Resolves the next pending stop on the given route, loads its office, fetches ETA via `mapsService.etaFor`, and — only when ETA is under the threshold, the office has a phone, and the stop is not already notified — sends SMS and flips `stop.notified10min = true`. All failure modes resolve (not reject) with a typed outcome so the caller can log without surfacing errors to the driver.
- `/Users/abraham/lab-dispatch/lib/heads-up.test.ts` — unit tests covering the truth table (see "Tests to write"). Uses `vi.mock('@/interfaces', ...)` to inject storage/maps/sms test doubles; `vi.useFakeTimers()` + a fixed now for determinism.

### New: permissions policy module
- `/Users/abraham/lab-dispatch/lib/permissions.ts` — pure functions, no I/O, no imports from `@/interfaces`:
  - `canDispatcherEditRoute({ role, routeDate, today }): boolean` — true when `role === "dispatcher" || role === "admin"` AND `routeDate >= today` (today defaults to `todayIso()` when omitted). Lexicographic string compare works for the `"YYYY-MM-DD"` format.
  - `canDriverCheckInStop({ role, profileId, routeDriverId }): boolean` — true only when `role === "driver"` AND `profileId === routeDriverId`. Admins, dispatchers, or mismatched drivers → false.
  - Types exported: `PermissionContext` helper types so call sites get compile-time checks.
- `/Users/abraham/lab-dispatch/lib/permissions.test.ts` — truth-table tests (see "Tests to write").

### New: request-to-stop helper
- `/Users/abraham/lab-dispatch/lib/request-to-stop.ts` — thin orchestrator exporting `convertRequestToStop({ routeId, requestId, position? }): Promise<Stop>`. Wraps the sequence:
  1. Call `storage.assignRequestToRoute(routeId, requestId, position)` — side effect flips request to `"assigned"` and returns the new `Stop`.
  2. Compute ETA: look up the new stop's preceding stop (by position), its pickup request's office, and the new stop's office. If BOTH offices have `lat`/`lng` coords, call `maps.etaFor({from: prev.office, to: new.office})` and compute `etaAt = now + durationSeconds * 1000`. (When the new stop is position 1, skip — no preceding stop to measure from.)
  3. Persist ETA via a new `storage.updateStopEta(stopId, etaAtIso)` method (see "Interfaces / contracts").
  4. Return the Stop (with `etaAt` populated when computed, else unchanged).
  Missing-data paths (no preceding stop, preceding office has no coords, target office has no coords, target office deleted) skip ETA and return the stop as-is — never throw.
- `/Users/abraham/lab-dispatch/lib/request-to-stop.test.ts` — unit tests (see "Tests to write").

### Modify: storage interface + mock
- `/Users/abraham/lab-dispatch/interfaces/storage.ts` — add two methods:
  - `markStopNotified10min(stopId: string): Promise<Stop>` — sets `notified10min = true` if currently false and returns the updated Stop. Throws `"stop <id> not found"` on bad id. Idempotent: calling it when the flag is already true returns the existing Stop without modification (does NOT throw). Rationale: future retry-safe callers; the heads-up module also checks the flag before calling so the idempotency is belt-and-suspenders.
  - `updateStopEta(stopId: string, etaAtIso: string): Promise<Stop>` — overwrites `etaAt`. Throws `"stop <id> not found"` on bad id. Accepts any ISO8601 string; validation is caller's job.
  Also extend `NotConfiguredError` stubs in `createRealStorageService()` for each new method.
- `/Users/abraham/lab-dispatch/mocks/storage.ts` — implement both new methods on `storageMock`. Add `notified10min: false` to the Stop literal in `assignRequestToRoute` so every newly-created stop carries the field. Update `seedStop` callers (test helper is untyped — just ensure the `Stop` type carries a default so tests still compile). **Do NOT** bake auto-complete into `markStopPickedUp`; storage stays a dumb store (scope bullet 2).
- `/Users/abraham/lab-dispatch/mocks/storage.test.ts` — extend with cases for `markStopNotified10min` (happy path + idempotent + bad id) and `updateStopEta` (happy path + bad id). Also assert `notified10min === false` on stops freshly created via `assignRequestToRoute`.

### Modify: types + schema
- `/Users/abraham/lab-dispatch/lib/types.ts` — add `notified10min: boolean` to `Stop`. Required (not optional) since the mock and the SQL schema both default to false; callers that read a stop always see either `true` or `false`. Also expand the JSDoc on the interface to mention the heads-up invariant.
- `/Users/abraham/lab-dispatch/supabase/schema.sql` — add column to `public.stops`:
  `notified_10min boolean not null default false`
  (between `picked_up_at` and `created_at`; matches the existing ordering of boolean/timestamp columns). No index needed — the column is read/written only via `stops.id` lookups.
- `/Users/abraham/lab-dispatch/lib/schema.test.ts` — add an assertion that `stops.notified_10min` exists with the correct type/default. Follows the convention of the file (regex match against the SQL text). One new `it(...)` block: `it("declares stops.notified_10min boolean default false", ...)` using a regex like `/notified_10min\s+boolean\s+not\s+null\s+default\s+false/i`.

### Modify: driver server actions
- `/Users/abraham/lab-dispatch/app/driver/actions.ts` — `recordLocationAction`:
  - After `storage.recordDriverLocation(...)` resolves, call `maybeNotifyOffice({ driverId: session.userId, lat: input.lat, lng: input.lng, routeId: route.id })`. Wrap in try/catch with `console.error` — a heads-up failure must not fail the GPS ping.
  - No change to auth / coord validation flow.
- `/Users/abraham/lab-dispatch/app/driver/actions.test.ts` — extend:
  - Add `recordLocationAction` case where coords land within 12-minute ETA of next stop's office → assert SMS sent with the exact copy + `notified10min` flipped on the stop.
  - Add case where ETA is above threshold → assert no SMS and flag still false.
  - Add case where `notified10min === true` already → no SMS sent even if under threshold.
  - Add case where office has no phone → no SMS, flag stays false (office still in preferred-sender list, but `sms.sendSms` never invoked).
  - Add case where `sms.sendSms` rejects → `recordLocationAction` still resolves and the location is persisted (call `expect(storage.listDriverLocations(...))` to verify).
- `/Users/abraham/lab-dispatch/app/driver/route/actions.ts` — `pickupStopAction`:
  - After `storage.markStopPickedUp(stopId)` resolves, re-list the stops and check whether every stop on the route now has `pickedUpAt`. If so, call `storage.updateRouteStatus(route.id, "completed")`. Revalidate `/driver` so the driver landing page reflects the completion.
  - Wrap in try/catch around only the `updateRouteStatus` call (the pickup has already succeeded; an auto-complete failure should be logged, not propagated).
  - Also pipe the check through `canDriverCheckInStop` at the top (see next bullet) — currently the `loadActiveStopForDriver` helper hand-rolls this; keep the helper but have it delegate to `canDriverCheckInStop` for a single source of truth.
- `/Users/abraham/lab-dispatch/app/driver/route/actions.test.ts` — extend:
  - Auto-complete happy path: one-stop route, pickup → route status transitions to `completed` and `completedAt` is set.
  - Auto-complete with multiple stops: pickup on the last remaining pending stop triggers completion; pickup on a non-last stop does NOT transition.
  - Idempotency: calling `pickupStopAction` on an already-picked-up stop propagates the existing `"already picked up"` error; route status is unchanged.
  - Permission: admin session cannot pickup on behalf of a driver — existing `requireDriverSession` covers this; assert via test that an admin session redirects (smoke for the `canDriverCheckInStop` wiring).

### Modify: dispatcher assignment action
- `/Users/abraham/lab-dispatch/app/dispatcher/routes/actions.ts` — `addStopToRouteAction`:
  - Replace the direct `storage.assignRequestToRoute(...)` call with `convertRequestToStop({ routeId, requestId })` from `lib/request-to-stop.ts`. Preserves existing behavior for the mainline happy path and adds the ETA side effect when coords are available.
  - Add a permissions gate at the top: `if (!canDispatcherEditRoute({ role: session.role, routeDate: route.routeDate })) throw new Error("cannot edit past route")` after `requireDispatcherSession()`. Fetch the `route` first via `storage.getRoute(routeId)`; if missing, bail silently (match existing silent-bail behavior for empty `pickupRequestId`). The permissions module is a defensive layer; `requireDispatcherSession()` still handles the role check, but `canDispatcherEditRoute` adds the past-date guard.
  - Same gate should apply to `removeStopAction`, `moveStopUpAction`, `moveStopDownAction`, `startRouteAction`, `completeRouteAction`, `resetRouteAction`. These currently only call `requireDispatcherSession()`. Add a `guardCanEditRoute(routeId)` helper inside the same file that fetches the route and throws when `canDispatcherEditRoute` returns false. Each action calls the helper right after `requireDispatcherSession()`.
- `/Users/abraham/lab-dispatch/app/dispatcher/routes/actions.test.ts` — extend:
  - ETA-on-assignment happy path: two offices with coords, first stop already on route, second request assigned → assert `stop.etaAt` is populated and matches `now + mapsMock.etaFor(...)`.
  - ETA-skip: target office missing coords → stop created, `etaAt` undefined.
  - ETA-skip: no preceding stop (position 1) → stop created, `etaAt` undefined.
  - Past-date guard: dispatcher tries to assign on a route dated yesterday → action throws. Same for `removeStopAction`.
  - Future-date OK: dispatcher assigning on a route dated tomorrow succeeds.

## Interfaces / contracts

### `lib/heads-up.ts`
```ts
export interface MaybeNotifyParams {
  driverId: string;
  routeId: string;
  lat: number;
  lng: number;
}

export type HeadsUpOutcome =
  | { status: "notified"; stopId: string; etaSeconds: number }
  | { status: "skipped"; reason:
      | "no_next_stop"
      | "already_notified"
      | "no_office"
      | "no_office_coords"
      | "no_office_phone"
      | "eta_above_threshold"
      | "route_not_active"
    }
  | { status: "error"; error: string };

/**
 * Threshold: 12 minutes (720 seconds). Rationale: SPEC says "~10 minutes"; we
 * fire a bit early so a driver slightly ahead of schedule still triggers the
 * heads-up before they arrive. Single constant, not configurable in v1.
 */
export const HEADS_UP_THRESHOLD_SECONDS = 720;

/** The SMS body — exact string asserted in tests. */
export const HEADS_UP_COPY = "Your sample pickup is ~10 minutes away.";

export async function maybeNotifyOffice(
  params: MaybeNotifyParams,
): Promise<HeadsUpOutcome>;
```

Algorithm (in order, short-circuit on first skip):
1. Load route via `storage.getRoute(routeId)`. If missing or `status !== "active"` → `skipped: "route_not_active"`.
2. List stops via `storage.listStops(routeId)`. Find the first stop where `pickedUpAt` is unset. If none → `skipped: "no_next_stop"`.
3. If that stop has `notified10min === true` → `skipped: "already_notified"`.
4. Load the stop's pickup request via `storage.listPickupRequests()` (or a new single-request getter if convenient; see "Open questions"). Resolve `officeId`. If no office linked → `skipped: "no_office"`.
5. Load office via `storage.getOffice(officeId)`. If `lat`/`lng` are missing → `skipped: "no_office_coords"`.
6. Call `maps.etaFor({ from: { lat, lng }, to: { lat: office.lat, lng: office.lng } })`. If `durationSeconds >= HEADS_UP_THRESHOLD_SECONDS` → `skipped: "eta_above_threshold"`.
7. If `office.phone` is missing or fails `normalizeUsPhone` → mark the stop notified anyway (so we don't recheck every ping) and return `skipped: "no_office_phone"`. Note: debatable — alternative is to not mark and keep retrying. **Decision: mark notified.** A phone that was missing at first ping won't magically appear ping-to-ping; we avoid N calls to `maps.etaFor` per route.
8. Send SMS via `sms.sendSms({ to: office.phone, body: HEADS_UP_COPY })`. On error → `error: "..."`; do NOT mark notified (so a future ping can retry).
9. On success → call `storage.markStopNotified10min(stopId)` → return `notified: { stopId, etaSeconds }`.

### `lib/permissions.ts`
```ts
export interface EditRouteContext {
  role: UserRole;
  /** "YYYY-MM-DD" — same format as Route.routeDate. */
  routeDate: string;
  /** Defaults to todayIso() when omitted. Primarily for tests. */
  today?: string;
}

export function canDispatcherEditRoute(ctx: EditRouteContext): boolean;

export interface CheckInContext {
  role: UserRole;
  /** The session's userId. */
  profileId: string;
  /** route.driverId from the stop's parent route. */
  routeDriverId: string;
}

export function canDriverCheckInStop(ctx: CheckInContext): boolean;
```

### `lib/request-to-stop.ts`
```ts
export interface ConvertRequestToStopParams {
  routeId: string;
  requestId: string;
  /** Same semantics as storage.assignRequestToRoute's position. */
  position?: number;
}

/**
 * Orchestrates:
 *   1. storage.assignRequestToRoute(routeId, requestId, position)
 *   2. ETA compute when preceding stop + offices both have coords
 *   3. storage.updateStopEta(stop.id, etaAtIso) when applicable
 * Never throws on ETA failure — the stop assignment is the contract, ETA is
 * best-effort metadata. assignRequestToRoute errors DO propagate (route not
 * found, request already assigned, etc.).
 */
export async function convertRequestToStop(
  params: ConvertRequestToStopParams,
): Promise<Stop>;
```

### Storage additions
```ts
// In interfaces/storage.ts
interface StorageService {
  // ... existing methods ...
  /**
   * Sets notified10min = true if currently false. Idempotent — returns the
   * stored Stop whether or not the update actually changed anything.
   * Throws "stop <id> not found" on bad id.
   */
  markStopNotified10min(stopId: string): Promise<Stop>;

  /**
   * Overwrites etaAt with the given ISO8601 string. No validation of the
   * timestamp format (caller's job). Throws "stop <id> not found" on bad id.
   */
  updateStopEta(stopId: string, etaAtIso: string): Promise<Stop>;
}
```

### Type additions
```ts
// In lib/types.ts — Stop gains:
interface Stop {
  // ... existing fields ...
  /**
   * True once the 10-minute heads-up SMS has been sent to the office for
   * this stop. Set by lib/heads-up.ts via storage.markStopNotified10min.
   * Defaults to false on creation. Idempotent flag — never flipped back to
   * false during normal operation.
   */
  notified10min: boolean;
}
```

## Implementation steps

Each step is small enough that a builder can land + test it in one pass. Steps are ordered so every intermediate state compiles and passes tests.

1. **Schema + type + mock field.** Add `notified_10min boolean not null default false` to `public.stops` in `supabase/schema.sql`. Add `notified10min: boolean` to the `Stop` interface in `lib/types.ts`. Update `mocks/storage.ts` so `assignRequestToRoute` initializes `notified10min: false` on the literal. Update `lib/schema.test.ts` with the new assertion. Run `mocks/storage.test.ts` + `lib/schema.test.ts` — both should pass. No behavior yet; just the field.

2. **Storage methods `markStopNotified10min` + `updateStopEta`.** Add the method signatures + JSDoc to `interfaces/storage.ts`. Add `notConfigured()` stubs to `createRealStorageService()`. Implement on `storageMock`. Extend `mocks/storage.test.ts`: happy + idempotent + bad-id for `markStopNotified10min`; happy + bad-id for `updateStopEta`.

3. **Permissions module.** Write `lib/permissions.ts` + `lib/permissions.test.ts`. No integration yet. Module is self-contained (uses `lib/dates.ts#todayIso` and `lib/types.ts`).

4. **Wire permissions into dispatcher actions.** In `app/dispatcher/routes/actions.ts`, add a private `guardCanEditRoute(routeId)` helper and call it from `addStopToRouteAction`, `removeStopAction`, `moveStopUpAction`, `moveStopDownAction`, `startRouteAction`, `completeRouteAction`, `resetRouteAction`. Extend the existing actions test file with past-date / future-date cases.

5. **Request-to-stop helper.** Write `lib/request-to-stop.ts` + `lib/request-to-stop.test.ts`. Refactor `addStopToRouteAction` to call it. Existing tests in `app/dispatcher/routes/actions.test.ts` should still pass (mainline unchanged). Extend test file with ETA-on-assignment cases.

6. **Auto-complete route.** Modify `pickupStopAction` in `app/driver/route/actions.ts` to re-list stops and call `storage.updateRouteStatus(routeId, "completed")` when all are picked up. Wrap in try/catch. Extend `app/driver/route/actions.test.ts` with the auto-complete cases.

7. **Heads-up module.** Write `lib/heads-up.ts` + `lib/heads-up.test.ts`. Test module in isolation with mocked services.

8. **Wire heads-up into `recordLocationAction`.** In `app/driver/actions.ts`, call `maybeNotifyOffice(...)` after `recordDriverLocation` resolves; wrap in try/catch; log errors. Extend `app/driver/actions.test.ts` with the integration cases.

9. **Smoke.** Run the full `vitest` suite; run `pnpm lint` + `pnpm tsc --noEmit`; manually `pnpm dev` and walk the driver flow to confirm no regressions.

## Tests to write

### `lib/heads-up.test.ts`
- `returns notified when ETA is under threshold, SMS sent, flag flipped`
  - Seed: active route with one unstarted stop, office with coords + phone. Driver location 5 minutes away by haversine.
  - Assert: `sms.sendSms` called once with `{ to: office.phone, body: HEADS_UP_COPY }`; `storage.markStopNotified10min(stopId)` called once; outcome `status === "notified"` with matching `stopId`.
- `skips when ETA is above threshold`
  - Location far away. Assert: no SMS, flag untouched, outcome `status === "skipped", reason === "eta_above_threshold"`.
- `skips when stop already notified`
  - Seed stop with `notified10min: true`. Assert: no SMS, no `markStopNotified10min` call, outcome `reason === "already_notified"`.
- `skips when office has no phone but still marks notified`
  - Seed office with no `phone`. Assert: no SMS, `markStopNotified10min` IS called, outcome `reason === "no_office_phone"`.
- `skips when office has no coords`
  - Seed office with undefined `lat`/`lng`. Assert: no SMS, flag untouched, outcome `reason === "no_office_coords"`.
- `skips when no active route`
  - Route status `"pending"`. Assert: outcome `reason === "route_not_active"`.
- `skips when route has no pending stops`
  - All stops have `pickedUpAt` set. Assert: outcome `reason === "no_next_stop"`.
- `skips when pickup request has no office`
  - Stop's pickup request has no `officeId`. Assert: outcome `reason === "no_office"`.
- `uses the FIRST pending stop ordered by position`
  - Multiple stops; earlier one picked up, next one in line is position 2. Assert: heads-up targets position-2's office.
- `returns error outcome when sms.sendSms rejects`
  - Stub `sms.sendSms` to throw. Assert: outcome `status === "error"`; `markStopNotified10min` NOT called (so a retry is possible).

### `lib/permissions.test.ts`
- `canDispatcherEditRoute` truth table:
  - `role: "dispatcher"`, routeDate today → true
  - `role: "dispatcher"`, routeDate tomorrow → true
  - `role: "dispatcher"`, routeDate yesterday → false
  - `role: "admin"`, routeDate today → true
  - `role: "admin"`, routeDate yesterday → false
  - `role: "driver"`, routeDate today → false
- `canDriverCheckInStop` truth table:
  - `role: "driver"`, profileId matches → true
  - `role: "driver"`, profileId mismatches → false
  - `role: "admin"`, profileId matches → false (admin cannot check in)
  - `role: "admin"`, profileId mismatches → false
  - `role: "dispatcher"`, profileId matches → false

### `lib/request-to-stop.test.ts`
- `happy path: first stop on a route, no preceding, no ETA computed`
  - Empty route, assign request → stop created at position 1, `etaAt` undefined.
- `ETA computed when preceding stop + both offices have coords`
  - Seed route with one stop (office A with coords). Assign second request (office B with coords). Assert: `etaAt` populated, roughly equal to `now + mapsMock.etaFor(A, B).durationSeconds * 1000` within a 1s tolerance. Uses `vi.useFakeTimers()`.
- `ETA skipped when target office lacks coords`
  - Office B has no `lat`/`lng`. Assert: stop created, `etaAt` undefined.
- `ETA skipped when preceding office lacks coords`
  - Office A has no `lat`/`lng`. Assert: stop created, `etaAt` undefined.
- `ETA compute failure does not fail the assignment`
  - Stub `maps.etaFor` to throw. Assert: stop still created (pickup request flipped to `"assigned"`), `etaAt` undefined.
- `assignRequestToRoute errors propagate`
  - Call with unknown `routeId`. Assert: throws `"route <id> not found"`.

### `mocks/storage.test.ts` additions
- `assignRequestToRoute initializes notified10min to false`
- `markStopNotified10min happy path flips the flag`
- `markStopNotified10min is idempotent (second call does not throw, flag stays true)`
- `markStopNotified10min throws on bad id`
- `updateStopEta happy path sets etaAt`
- `updateStopEta throws on bad id`

### `lib/schema.test.ts` additions
- `declares stops.notified_10min boolean not null default false`

### `app/driver/actions.test.ts` additions
- `recordLocationAction calls maybeNotifyOffice and sends SMS on near-threshold ping`
- `recordLocationAction does not send SMS when far from next stop`
- `recordLocationAction does not re-send SMS when notified10min is true`
- `recordLocationAction does not send SMS when office has no phone, but location is still persisted`
- `recordLocationAction still persists location when sms.sendSms rejects`

### `app/driver/route/actions.test.ts` additions
- `pickupStopAction auto-completes the route when it is the last pending stop`
- `pickupStopAction does not complete the route when other stops remain pending`
- `pickupStopAction auto-complete sets completedAt`
- `pickupStopAction propagates markStopPickedUp errors and does not attempt completion`

### `app/dispatcher/routes/actions.test.ts` additions
- `addStopToRouteAction populates etaAt when preceding stop + both offices have coords`
- `addStopToRouteAction leaves etaAt undefined at position 1`
- `addStopToRouteAction leaves etaAt undefined when target office lacks coords`
- `addStopToRouteAction throws when route is in the past (canDispatcherEditRoute)`
- `removeStopAction throws when route is in the past`
- `moveStopUpAction / moveStopDownAction throw when route is in the past`
- `startRouteAction / completeRouteAction / resetRouteAction throw when route is in the past`

## External services touched
- **Storage (Supabase)** via `interfaces/storage.ts` — new methods `markStopNotified10min`, `updateStopEta`; new column `stops.notified_10min`. Mock-backed in this feature; real adapter is deferred.
- **Maps (Mapbox)** via `interfaces/maps.ts` — existing `etaFor` method consumed by `lib/heads-up.ts` and `lib/request-to-stop.ts`. Mock-backed; real adapter deferred.
- **SMS (Twilio)** via `interfaces/sms.ts` — existing `sendSms` method consumed by `lib/heads-up.ts` for the heads-up copy. Mock-backed; real adapter deferred.
- **Email (Postmark)** — NOT touched in this feature. Heads-up is SMS-only per SPEC.
- **Anthropic** — NOT touched.

## Open questions
1. **Heads-up threshold: 10 vs 12 minutes?** SPEC says "~10 minutes." We picked 12 minutes (720s) because drivers running slightly ahead of schedule should still trigger the heads-up before arrival. If product wants literal 10, change `HEADS_UP_THRESHOLD_SECONDS` to 600. Leaving at 720 as default; flag for review.
2. **Heads-up retry when office has no phone.** Plan marks `notified10min = true` to avoid recomputing ETA on every ping for a phoneless office. Alternative: leave flag false and re-skip silently on each ping. Trade-off is `storage.getOffice` + `maps.etaFor` cost vs. the (unlikely) case that a phone appears mid-route. **Decided: mark notified.** Documented in step 7 of the heads-up algorithm.
3. **Single-request getter on storage?** `lib/heads-up.ts` step 4 currently resolves a stop's pickup request by `listPickupRequests().find(...)`. A `storage.getPickupRequest(id): Promise<PickupRequest | null>` method would be cleaner and O(1). Not strictly required for this feature but obvious next adjacency. **Decided: add it as a tiny parallel change in step 2 (with the other storage additions), test it alongside.** If the reviewer objects, fall back to full-scan; performance is a non-issue in mock.
4. **Permission gate on `/dispatcher/map` / read-only dispatcher pages.** `canDispatcherEditRoute` is write-side only. Should read-side past-route viewing be gated too? **Decided: no.** Reading historical routes is fine (SPEC says admin can view last 30 days of reports); the guard is purely "can I edit this thing."
5. **Should `pickupStopAction` auto-complete live in storage or the action?** Scope says "prefer action-side." Followed. The trade-off is that a future real-Supabase adapter could implement auto-complete as a DB trigger for atomicity — but that can migrate later without UI changes.
