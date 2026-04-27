# Phase 0 Audit — Lab Dispatch

**Date:** 2026-04-23
**Branch:** `feature/fix-login-redirect-loop` (tip `5f1539b`)
**Mode audited:** `USE_MOCKS=false` (real Supabase + all 4 external adapters)

## Summary counts

| Severity | Count |
|---|---|
| CRITICAL | 4 |
| HIGH | 3 |
| MEDIUM | 3 |
| LOW | 2 |
| **Total findings** | **12** |

Baseline gates: **all green.** Schema drift: **none found** at the column level. The bugs concentrate in three areas: (1) a `"use server"` file that exports non-async values, (2) a data-seeding gap between `seed-live-accounts.ts` and the `drivers` row, and (3) a PostgREST query pattern (`.or()` across an embedded resource) used by both `countDispatcherDashboard` and `listMessages(flagged)` that is fragile under `head: true`.

---

## BASELINE

All four gates pass on the current branch.

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | 0 warnings / 0 errors |
| Tests | `npm test -- --run` | **661/661 passed** across 53 files (was 659 in INTEGRATION_REPORT — +2 since) |
| Build | `npm run build` | 28 routes compiled, middleware 85 kB |

No regressions against the claims in `INTEGRATION_REPORT.md`. The integration-era smoke-check and seed-live-accounts scripts were not re-run in this pass (no live DB calls were made during Phase 0 per budget).

Environment: `.env.local` has `USE_MOCKS=false` plus real Supabase URL/anon/service-role, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN`, and Twilio SID/token/from. `POSTMARK_*` absent (email still mocked — consistent with BLOCKERS.md).

---

## INVENTORY

### Admin (`app/admin/**`)

| Route / File | Reads | Writes |
|---|---|---|
| `/admin` `page.tsx` | `storage.countAdminDashboard()` → COUNT `drivers`, `doctors`, `offices`, `pickup_requests WHERE status='pending'` | — |
| `/admin/drivers` `page.tsx` | `listDrivers()` → `drivers` + `profiles(full_name,phone)` ; `listDriverAccounts()` → `drivers.profile_id` + `auth.admin.listUsers()` | — |
| `/admin/drivers/new` `page.tsx` | `listDrivers()` | — |
| `/admin/drivers/new` `actions.ts:createDriverAction` | — | `createDriver()` → `auth.admin.createUser` + INSERT `profiles` + INSERT `drivers` (best-effort rollback) |
| `/admin/drivers/[id]` `page.tsx` | `getDriver(profileId)` | — |
| `/admin/drivers/[id]` `actions.ts:updateDriverAction` | `getDriver(profileId)` | UPDATE `profiles(full_name,phone)` + UPDATE `drivers(vehicle_label,active)` |
| `/admin/drivers/[id]` `actions.ts:deactivateDriverAction` | — | UPDATE `drivers SET active=false` |
| `/admin/doctors` `page.tsx` | `listDoctors()` ; `listOffices()` | — |
| `/admin/doctors/new` `actions.ts:createDoctorAction` | — | INSERT `doctors` |
| `/admin/doctors/[id]` `page.tsx` | `getDoctor(id)` ; `listOffices()` | — |
| `/admin/doctors/[id]` `actions.ts:{update,delete}DoctorAction` | `getDoctor(id)` | UPDATE / DELETE `doctors` |
| `/admin/offices` `page.tsx` | `listOffices()` | — |
| `/admin/offices/new` `actions.ts:createOfficeAction` | `listOffices()` (slug collision) | INSERT `offices` |
| `/admin/offices/[id]` `page.tsx` | `getOffice(id)` | — |
| `/admin/offices/[id]` `actions.ts:{update,deactivate}OfficeAction` | `getOffice(id)` / `listOffices()` | UPDATE `offices` |

### Dispatcher (`app/dispatcher/**`)

| Route / File | Reads | Writes |
|---|---|---|
| `/dispatcher` `page.tsx` | `countDispatcherDashboard(todayIso)` → COUNT `pickup_requests WHERE status='pending'`, COUNT `routes WHERE status='active'`, SELECT `routes(id) WHERE route_date=today`, COUNT `stops WHERE route_id IN (...)`, COUNT `messages` with embedded `pickup_requests(status)` filtered via `.or("pickup_request_id.is.null,pickup_requests.status.eq.flagged")` | — |
| `/dispatcher/requests` `page.tsx` | `listPickupRequests()` ; `listOffices()` ; `listRoutes({date})` ; `listDrivers()` | — |
| `/dispatcher/requests` `actions.ts:assignRequestToRouteAction` | guards | INSERT `stops` + UPDATE `pickup_requests SET status='assigned'` (non-atomic) |
| `/dispatcher/requests` `actions.ts:{flag,markResolved}Action` | — | UPDATE `pickup_requests.status/flagged_reason` |
| `/dispatcher/requests/new` `actions.ts:createManualRequestAction` | `getOffice(id)` | INSERT `pickup_requests(channel='manual')` |
| `/dispatcher/routes` `page.tsx` | `listRoutes()` ; `listDrivers()` ; `countDispatcherDashboard()` | — |
| `/dispatcher/routes/new` `actions.ts:createRouteAction` | `getDriver(id)` | INSERT `routes` |
| `/dispatcher/routes/[id]` `page.tsx` | `getRoute(id)` ; `listStops(routeId)` ; `listPickupRequests()` ; `listOffices()` ; `getDriver(driverId)` | — |
| `/dispatcher/routes/[id]` `actions.ts:addStopToRouteAction` | `getRoute` guard (past-date check) | INSERT `stops` + UPDATE `pickup_requests` ; best-effort `updateStopEta` |
| `/dispatcher/routes/[id]` `actions.ts:removeStopAction` | — | DELETE `stops` + re-number + UPDATE `pickup_requests SET status='pending'` |
| `/dispatcher/routes/[id]` `actions.ts:{moveStopUp,moveStopDown,reset,start,complete}RouteAction` | `listStops` | UPDATE `stops.position` / UPDATE `routes.status+started_at+completed_at` |
| `/dispatcher/map` `page.tsx` | `listDriverLocations({sinceMinutes: 15})` — SELECT `driver_locations WHERE recorded_at >= cutoff` + in-memory dedupe | — |
| `/dispatcher/messages` `page.tsx` | `listMessages({flagged?})` — flagged branch: `messages` + embedded `pickup_requests(status)` with `.or()` filter | — |
| `/dispatcher/messages` `actions.ts:convertMessageToRequestAction` | — | INSERT `pickup_requests` + UPDATE `messages.pickup_request_id` |
| `/dispatcher/messages` `actions.ts:simulateInboundAction` (mock-mode only) | — | invokes `handleInboundMessage` pipeline |

### Driver (`app/driver/**`)

| Route / File | Reads | Writes |
|---|---|---|
| `/driver` `page.tsx` | `getDriver(profileId)` ; `getTodaysRouteForDriver(profileId)` → SELECT `routes WHERE driver_id=? AND route_date=today` ; `listStops(routeId)` | — |
| `/driver` `actions.ts:startRouteAction` | `getRoute` guard | UPDATE `routes SET status='active', started_at=now()` |
| `/driver` `actions.ts:completeRouteAction` | `getRoute` + `listStops` (verify all picked up) | UPDATE `routes SET status='completed', completed_at=now()` |
| `/driver` `actions.ts:recordLocationAction` | `getTodaysRouteForDriver` | INSERT `driver_locations` ; side-effect `maybeNotifyOffice` (see /driver/route/[stopId]) |
| `/driver/route` `page.tsx` | same as `/driver` | — |
| `/driver/route/[stopId]` `page.tsx` | `getStop(stopId)` ; `getRoute(routeId)` ; `getDriver(driverId)` ; `listPickupRequests()` (filtered in-memory) ; `getOffice(officeId)` | — |
| `/driver/route/[stopId]` `actions.ts:arriveAtStopAction` | `getStop` + `getRoute` guards | UPDATE `stops SET arrived_at=now()` |
| `/driver/route/[stopId]` `actions.ts:pickupStopAction` | same | UPDATE `stops SET picked_up_at=now()` ; auto-complete UPDATE `routes` if last stop ; may UPDATE `stops.notified_10min=true` via heads-up |

### Public pickup form (`app/pickup/**`)

| Route / File | Reads | Writes |
|---|---|---|
| `/pickup/[slugToken]` `page.tsx` | `findOfficeBySlugToken(slug, token)` → SELECT `offices WHERE slug=? AND pickup_url_token=? AND active=true` | — |
| `/pickup/[slugToken]` `actions.ts:submitPickupRequestAction` | `findOfficeBySlugToken` | INSERT `pickup_requests(channel='web')` + best-effort `email.sendEmail` |

### API routes (`app/api/**`)

| Route / File | Reads | Writes |
|---|---|---|
| `POST /api/sms/inbound` | `findOfficeByPhone(from)` | INSERT `messages` + conditionally INSERT `pickup_requests` and/or UPDATE `messages.pickup_request_id` |
| `POST /api/email/inbound` | `findOfficeByEmail(from)` | same |

### Schema-drift scan result

Every column string in `interfaces/storage.real.ts` maps cleanly to a column in `supabase/schema.sql`. Every mapper in `lib/supabase-mappers.ts` agrees with the row shapes. **No column-level drift.** (The exhaustive table-by-table check was run by a sub-agent and cross-checked by hand for the suspicious hot spots: `countDispatcherDashboard`, `listMessages(flagged)`, `listDriverLocations`, `findOfficeBySlugToken`, `createDriver`.)

The bugs found live at the **query-semantics** and **data-seeding** layers, not at the column-name layer — so the user's guess that "schema drift causes half the bugs" is *not* borne out by this audit.

---

## FINDINGS

Each finding has: severity, file:line, what's wrong, suggested fix. Ordered by severity, then by user-reported letter.

---

### F-01 · CRITICAL · bug (b) — `/pickup/[slugToken]` form crashes at build / first submit

**File:** [app/pickup/[slugToken]/actions.ts:12–25](app/pickup/[slugToken]/actions.ts:12)

A `"use server"` file may only export async functions (plus type-only exports). Lines 12–19 export the `PickupFormState` **type** (fine — erased at runtime), but line 21–25 exports **`INITIAL_PICKUP_FORM_STATE`**, a plain `const` object — at runtime this is a non-async value, which Next.js refuses.

The client component [app/pickup/[slugToken]/_components/PickupRequestForm.tsx:5](app/pickup/[slugToken]/_components/PickupRequestForm.tsx:5) imports both `INITIAL_PICKUP_FORM_STATE` and `submitPickupRequestAction` from this file — hence the user-reported error "A 'use server' file can only export async functions, found object".

**Fix:** Move `INITIAL_PICKUP_FORM_STATE` (and probably `PickupFormState`) into a new `app/pickup/[slugToken]/form-state.ts` that has no `"use server"` directive; update both imports. Same pattern is already used elsewhere (e.g. `lib/admin-form.ts`).

**Why this has not tripped tests yet:** the action-unit tests import the action directly, and the codepath doesn't require Next's server-action compiler. The failure is in Next's boundary check at HTTP time.

---

### F-02 · CRITICAL · bug (c) — `driver@test` lands on `/driver` and sees "Driver not found"

**File:** [scripts/seed-live-accounts.ts:37–41, 94–104](scripts/seed-live-accounts.ts:37) vs [interfaces/storage.real.ts:199–207](interfaces/storage.real.ts:199)

`seed-live-accounts.ts` seeds three rows in `auth.users` plus three rows in `public.profiles` (role='driver' for driver@test). It does **not** insert a corresponding row into `public.drivers`.

But the driver page does `storage.getDriver(session.userId)` which runs `SELECT ... FROM drivers WHERE profile_id=?` — no driver row → `null` → "Driver not found" banner ([app/driver/page.tsx:47–56](app/driver/page.tsx:47)).

This is a **data-seeding gap**, not a code bug. The mock-mode path works because `mocks/seed.ts` explicitly seeds a `drivers` row for Miguel keyed on `"user-driver"` — that step is absent for the real DB.

**Fix options:**
- (preferred) Extend `scripts/seed-live-accounts.ts` so that, for every account whose role is `"driver"`, it also upserts a `public.drivers` row (`profile_id=userId, vehicle_label=null, active=true`).
- (alternative) Have `/driver` gracefully handle the `profiles.role='driver'` + no `drivers` row case by showing an actionable banner ("Your driver profile is not set up — contact an admin"), not the misleading "Driver not found".

Both are cheap. The first is the load-bearing fix.

---

### F-03 · CRITICAL · bug (d, root) — Real DB has no demo data; dashboards show all zeros

**Files:** [mocks/seed.ts](mocks/seed.ts) (mock-only, ~451 lines of demo data) vs [scripts/seed-live-accounts.ts](scripts/seed-live-accounts.ts) (real-DB, 3 accounts only)

`mocks/seed.ts` auto-populates 6 offices, 10 doctors, 4 drivers, 20 pickup requests, 2 routes, 10 driver-locations, 5 messages **in memory only** — the real-DB seeder hits exactly 3 rows (auth + profiles) per account.

Under `USE_MOCKS=false` the real DB is empty except for those 3 profiles. So:
- `/admin` shows Drivers=0, Doctors=0, Offices=0, Pending pickups=0 (correct behavior on an empty DB — but zero-state UX is indistinguishable from "something is broken").
- `/dispatcher` ditto — and also crashes on a separate error (F-04).
- `/driver` has no route → "No route assigned yet" (which is accurate, but there is no way to test the driver flow).

**Fix:** Add `scripts/seed-live-data.ts` that idempotently writes a minimal demo dataset to the real project (tracked by a sentinel, e.g. an office with a known slug). Mirror the structure of `mocks/seed.ts` but go through the admin supabase client.

**Adjacent gap:** Admin CRUD through the UI works (F-02 aside for driver creation) so a human operator can populate the DB by hand — this is the current documented workaround in INTEGRATION_REPORT.md step 2 ("Create an office via /admin/offices/new"). Acceptable short-term; the seeder is the permanent fix.

---

### F-04 · CRITICAL · bug (a) — `countDispatcherDashboard` error is masked by `wrapSupabaseError`; query is also fragile

**Files:** [interfaces/storage.real.ts:969–992](interfaces/storage.real.ts:969) (query) + [lib/supabase-mappers.ts:433–448](lib/supabase-mappers.ts:433) (wrapper)

Two problems compound:

**(a1) The wrapper strips useful fields.** `wrapSupabaseError` reads only `err.code` and `err.message`. A PostgREST error object also carries `.details` and `.hint` — those are where the *useful* message lives when `.code`/`.message` are empty (which happens for certain embedded-resource filter errors). Result: the dashboard crashes with the unhelpful `"countDispatcherDashboard failed (code=unknown)"` the user reported, with no suffix.

**(a2) The query itself is likely the source of the crash.** The `flaggedMsgsRes` query (lines 988–991) does:

```ts
.select("*, pickup_requests(status)", { count: "exact", head: true })
.or("pickup_request_id.is.null,pickup_requests.status.eq.flagged")
```

Filtering on an *embedded* resource (`pickup_requests.status.eq.flagged`) combined with a LEFT-join embed (the default) combined with `head: true` + `count: "exact"` is a known PostgREST footgun:
- Without `!inner` on the embed, the embedded filter does not restrict the outer row set. Rows where the embedded `pickup_requests` is `null` always pass `pickup_request_id.is.null`, but also silently pass the `or()` even when you'd expect them to fail.
- Under certain PostgREST versions `count: "exact"` combined with filters on embedded resources errors out at the planner. That error can come back with an empty `.code`/`.message` if postgrest stringifies a Postgres-side plpgsql error badly — which matches the "code=unknown" the user sees.

**Fix sequence:**
1. Unmask first: extend `wrapSupabaseError` to also include `details` and `hint` in the thrown message (still with the same URL/JWT redactions). This alone will tell us the real PG error on the next manual QA run.
2. Then fix the query. Likely rewrite to split into two COUNT queries:
   - `count(messages) where pickup_request_id is null` + `count(messages join pickup_requests on ...) where pickup_requests.status='flagged'` — or —
   - use `!inner` on the embed and take the two branches of the OR as separate queries summed in JS.

The same fragile pattern exists in `listMessages(flagged)` ([interfaces/storage.real.ts:829–838](interfaces/storage.real.ts:829)) — that path does *not* use `head: true`/`count: "exact"`, so it may succeed where the dashboard fails, but the filter semantics are still wrong (a linked-to-completed message would come back when it should not). Verify both.

---

### F-05 · HIGH · bug (f) — Form validation errors are invisible; native-only UX

**Files:** [app/pickup/[slugToken]/_components/PickupRequestForm.tsx:80–135](app/pickup/[slugToken]/_components/PickupRequestForm.tsx:80), same pattern in every `_components/*Form.tsx`

Every form has **both** native HTML5 validation (`required`, `minLength`, `min`, `max`, `step`) **and** server-side validation that returns `fieldErrors` to be rendered. The client renders the server errors correctly — but browsers short-circuit on the HTML5 attributes *before* the form is submitted, so the server action never runs and the custom per-field text never appears. Users see only the generic native popover + blue focus ring on the invalid field.

Affected:
- `PickupRequestForm.tsx` (notes `required minLength=10`, sampleCount `min=1 max=99`)
- `NewDriverForm.tsx`, `NewDoctorForm.tsx`, `NewOfficeForm.tsx`, `EditDriverForm.tsx`, `EditDoctorForm.tsx`, `EditOfficeForm.tsx` (spot-check — same pattern, imports `fieldErrors` from server state)
- `NewRouteForm.tsx`, `NewManualRequestForm.tsx`

**Fix options:**
- (simplest) Add `noValidate` to every `<form>` and rely entirely on server validation.
- (cleaner) Remove the HTML5 validation attributes from inputs whose validation is duplicated server-side; keep `required` + `type=email` for plain sanity, drop `minLength` / numeric ranges. The server is authoritative anyway.

---

### F-06 · HIGH · bug (e) — Raw ISO timestamp rendered in admin drivers list

**File:** [app/admin/drivers/page.tsx:62](app/admin/drivers/page.tsx:62)

`{d.createdAt}` renders the ISO string verbatim (e.g. `2026-04-15T12:34:56.789Z`). The helper `formatShortDateTime` / `formatDateIsoToShort` in `lib/dates.ts` is already imported and used correctly elsewhere (driver page, dispatcher requests, dispatcher messages, dispatcher map).

**Scan result:** This is the **only** place across `app/**/*.tsx` where a timestamp-shaped field is rendered directly without formatting. The user's framing ("across the UI") is over-broad — almost every other surface uses `formatShortDateTime`. Flagged as HIGH anyway because it's user-visible on a page admins hit daily.

**Fix:** `{formatShortDateTime(d.createdAt)}`.

---

### F-07 · HIGH — `listMessages({flagged: true})` uses the same fragile embedded-`or()` pattern

**File:** [interfaces/storage.real.ts:829–838](interfaces/storage.real.ts:829)

Paired with F-04. The dispatcher messages page (`/dispatcher/messages`, flagged tab) will hit this path. Without `head: true` it probably doesn't crash — but the filter semantics on the LEFT-join embed mean the result set can miss rows (a message whose linked request was deleted and set to null via `on delete set null`) or include the wrong rows (any message linked to a non-flagged request where the embed returns null because of RLS). Has not been manually QA'd per INTEGRATION_REPORT; flagging preemptively.

**Fix:** Rewrite as two queries OR'd in JS, or use `pickup_requests!left(status)` plus a composite `.or()` that addresses the two cases explicitly. Same fix pattern as F-04.

---

### F-08 · MEDIUM — `wrapSupabaseError` drops `.details` and `.hint`

**File:** [lib/supabase-mappers.ts:433–448](lib/supabase-mappers.ts:433)

Separate from F-04's specific crash: this is a general debuggability regression. Every PostgREST call that fails with a useful error in `.details` or `.hint` surfaces only `"… failed (code=CODE)"` at the UI boundary. The wrapper was defensive about secret leaks (URLs, JWTs) and should remain so — but `.details` and `.hint` do not normally contain secrets, and redacting them through the same sanitizer is safe.

**Fix:** Include `err.details` and `err.hint` in the suffix (still applying the URL/JWT/service_role scrubs).

Unit tests in `lib/supabase-mappers.test.ts` already assert the scrubs — extend them to cover `.details`/`.hint` on input.

---

### F-09 · MEDIUM — Inventory gap: `getDriverByAuthId` / recovery from "profile exists but drivers row missing"

Symptom of F-02 — but also a shape concern. There's no defensive path for a signed-in driver whose `drivers` row has been soft-deleted (`active=false`) or never created. Today `storage.getDriver` returns `null` in both cases and the UI can't tell them apart.

**Suggest:** a second `getDriver` variant that reads from `profiles` first (verifying the user is role=driver) and joins `drivers` left, so the UI can distinguish (a) "user isn't actually a driver", (b) "driver profile deactivated", (c) "driver row never created".

Low priority unless F-02 recurs.

---

### F-10 · MEDIUM — `assignRequestToRoute` + `removeStopFromRoute` + `reorderStops` are non-atomic

**Files:** `interfaces/storage.real.ts` (functions `assignRequestToRoute`, `removeStopFromRoute`, `reorderStops`, `createRequestFromMessage`)

Documented as accepted in BUILD_LOG.md (storage-adapter feature, decision Q3 — "v1 scale, UNIQUE constraints catch races"). Flagging here so it appears in the audit paper trail: under concurrent dispatcher edits, partial failure leaves orphaned `stops` rows or a `pickup_request.status` out of sync with its stop.

No fix proposed for v1; revisit when pickup volume requires a transaction.

---

### F-11 · LOW — Admin `deactivate` flow writes `active=false` but never uses the column for filtering

**Observation from inventory:** `offices.active` and `drivers.active` are written by the deactivation actions and by the office form. Reads that honor it: `findOfficeBySlugToken` (returns null when `active=false`), `findOfficeByPhone`/`findOfficeByEmail` (same), `mocks/seed.ts`. Reads that **do not** honor it: `listOffices` (admin + dispatcher + driver stop-detail page all see deactivated offices), `listDrivers` (dispatcher's driver dropdown includes deactivated drivers).

Not a correctness bug per the current spec — "active" is soft-delete, not "visible to dispatcher only if active". Flag only because it was unclear whether BUILD_LOG.md's "soft delete" decision extended to filtering.

---

### F-12 · LOW — Secrets visible in `.env.local`; consider Vercel-only rotation before deploy

Not a code bug. `.env.local` is gitignored (verified) so there's no repo exposure. But the file contains a real Supabase service-role key, Anthropic API key, and Twilio auth token. Since this audit Bash-grepped those values (to inspect `USE_MOCKS=false`), they have been read by me in this session. If the session transcript is stored or shared, rotate all three before production.

Separately: when these migrate to Vercel env, the service-role key should be `encrypted + production-only` (not `development`/`preview`), per the Vercel docs.

---

## Stop here

Phase 0 complete. Findings captured, nothing fixed. Awaiting direction on which phase to run next. Recommended sequence if asked:

1. **F-01** (pickup form crash) — one-file move, ~5 min.
2. **F-04 step 1** (unmask `wrapSupabaseError`) — 5 min; unblocks diagnosing F-04 step 2 and any future Supabase errors.
3. **F-02** (seed the `drivers` row) — 10 min.
4. **F-04 step 2 + F-07** (rewrite the two `.or()`-on-embed queries) — 30 min with tests.
5. **F-05** (`noValidate` sweep) — 10 min.
6. **F-06** (one-line date format) — 1 min.
7. **F-03** (real-DB seeder) — 1–2 hours.
