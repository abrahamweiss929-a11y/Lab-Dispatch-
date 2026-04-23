# Phase 1 Plan — CRITICAL bug fixes

Branch: `feature/fix-login-redirect-loop` (no merges to main)

---

## F-01 — `"use server"` non-async export in pickup actions

**Root cause:** `app/pickup/[slugToken]/actions.ts` declares `"use server"` but exports `INITIAL_PICKUP_FORM_STATE` (a plain `const` object) and `PickupFormState` (a type). Next.js server-action boundary validation rejects the non-async const at HTTP request time.

**Fix:** Create `app/pickup/[slugToken]/form-state.ts` (no directive) and move the type + const there. Update imports in `actions.ts` (removes the export) and `PickupRequestForm.tsx` (changes source). The existing `actions.test.ts` imports both from `./actions` — update that import too.

**Regression test:** New `app/pickup/[slugToken]/form-state.test.ts` that (a) verifies `INITIAL_PICKUP_FORM_STATE` is importable from `./form-state` with the expected shape, and (b) imports `* as actionsModule` from `./actions` and asserts every enumerable runtime export is an async Function (catches any future non-async export landing back in the file).

---

## F-02 — `seed-live-accounts.ts` never inserts `drivers` row

**Root cause:** The seeder creates `auth.users` + `public.profiles` for driver@test but never inserts into `public.drivers`. `storage.getDriver(profileId)` queries `drivers WHERE profile_id=?` → null → "Driver not found" on `/driver`.

**Fix:** In `scripts/seed-live-accounts.ts`, extend `seedAccount` so that accounts with `role === "driver"` also upsert a `public.drivers` row (`profile_id=userId, vehicle_label=null, active=true`) after the `profiles` upsert.

**Regression test:** Extract the "upsert-drivers-for-driver-role-accounts" step into a tested helper, or add a test in a new `scripts/seed-live-accounts.test.ts` that mocks the Supabase admin client, runs the seeder, and asserts that `sb.from("drivers").upsert(...)` is called exactly once (for the driver account) with the expected shape. The admin/dispatcher accounts must NOT trigger a drivers upsert.

---

## F-04 — `wrapSupabaseError` drops `.details`/`.hint`; `countDispatcherDashboard` fragile PostgREST query

Two sub-fixes committed together (the wrapper fix enables diagnosis; the query fix prevents the crash).

**Fix A — wrapper:** Extend `wrapSupabaseError` in `lib/supabase-mappers.ts` to include `err.details` and `err.hint` in the suffix (after the same URL/JWT/service_role scrubs). Signature stays the same — both fields are optional strings.

**Fix B — query:** Replace the `.or("pickup_request_id.is.null,pickup_requests.status.eq.flagged")` pattern (used in `countDispatcherDashboard` for the `flaggedMessages` count, and in `listMessages({flagged})`) with JS-side filtering: fetch messages with embedded `pickup_requests(status)`, then count/filter client-side. Same approach in both call sites. This eliminates the PostgREST embedded-resource `.or()` footgun entirely.

**Regression tests:**
- `wrapSupabaseError` test: assert `.details` and `.hint` values appear in the error message; assert they are also scrubbed for URLs/JWTs.
- `countDispatcherDashboard` test: update the fakeClient test to remove the old `messages` COUNT enqueue (now a SELECT) and add a `data` array; assert `flaggedMessages` counts only null-linked + flagged-linked rows, excluding non-flagged-linked rows.
- `listMessages({flagged})` test: add a case with mixed data (unlinked, flagged-linked, completed-linked) and assert only the first two come back.

---

## F-03 — No real-DB demo seeder; dashboards always show 0 counts

**Root cause:** `mocks/seed.ts` populates in-memory state only. The real Supabase project has no offices/doctors/drivers/pickup-requests/routes after running `seed-live-accounts`. Dashboards show zeros correctly but the app is untestable.

**Fix:** Create `scripts/seed-live-data.ts` (idempotent, uses service-role admin client) that seeds: 1 office with a known sentinel slug (`lab-dispatch-demo-v1`), 1 doctor linked to it, and confirms the driver@test user has a `drivers` row (defers to F-02 for that). Gate on the sentinel office's existence to skip on re-run. Wire as `npm run seed-live-data`.

**Regression test:** Unit test `scripts/seed-live-data.test.ts` that mocks the Supabase client and asserts: (a) on first run (no existing office), inserts office + doctor; (b) on second run (sentinel exists), skips inserts.

---
