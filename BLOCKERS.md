# Blockers

Things that require the user's accounts, API keys, or decisions before v1 can go to production. None of these block the autonomous local build (everything runs via mocks), but each must be resolved when the user returns.

## Unresolved

### [inbound-email] Email send + inbound parsing
**Type:** API key + account + decision
**Needed for:** pickup email intake, outbound auto-confirmations, dispatcher notifications
**What to provide:** `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL`, `POSTMARK_INBOUND_SECRET` (orchestrator chose Postmark for simpler inbound webhook format). Alternative: SendGrid (`SENDGRID_API_KEY`) — swap the three vars plus one env-var name in `interfaces/email.ts` and this entry if the user prefers it.
**Where it plugs in:** `interfaces/email.ts` (real adapter); inbound webhook route (to be added with email intake feature)
**Workaround in place:** `mocks/email.ts` stores sends in an in-memory array with deterministic ids (`email-mock-0`, `email-mock-1`, …); empty `to` rejects with a defensive mock-side error.

### [supabase] Supabase project URL + keys
**Type:** API key + account
**Needed for:** storage (offices, drivers, doctors, pickup requests), auth sessions, RLS policies
**What to provide:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
**Where it plugs in:** real storage adapter lives in `interfaces/storage.real.ts` with the shared admin client in `interfaces/supabase-client.ts` (both `"server-only"`); `interfaces/storage.ts` re-exports `createRealStorageService` so callers keep the existing import path. Real auth adapter now lives in `interfaces/auth.real.ts` (`"server-only"`); `interfaces/auth.ts` re-exports `createRealAuthService`. The storage + auth adapters both use `SUPABASE_SERVICE_ROLE_KEY` server-side (bypasses RLS; RLS policies land in their own feature). The real-mode login/logout flow lives in `app/login/actions.ts` + `app/logout/route.ts` and calls `@supabase/ssr` directly via `lib/supabase-server.ts` (user-session client, anon key) — NOT the `AuthService` interface, which is unreachable from real-mode code paths. Edge middleware refreshes Supabase cookies via `lib/supabase-middleware.ts::updateSession` and reads a companion `ld_role` cookie via `readSessionFromRequest` (unsigned-JWT fast path — authoritative resolver is `getUserFromSession()`).
**Workaround in place:** `mocks/storage.ts` uses in-memory `Map`s for offices/drivers/doctors/pickup_requests; `mocks/auth.ts` uses three seeded accounts (`driver@test`, `dispatcher@test`, `admin@test`, shared password `test1234`). Cookie migration has landed: `USE_MOCKS=true` (or unset) still writes the legacy `ld_session` base64 JSON cookie via `lib/session.ts`'s mock branch; `USE_MOCKS=false` writes the Supabase `sb-*` cookies (via `signInWithPassword`) + the `ld_role` Edge companion cookie. Both branches ship in one `lib/session.ts` + Edge-safe `lib/session-codec.ts` pair so `middleware.ts` doesn't pull `next/headers`. Session reads: mock mode decodes the cookie; real mode awaits `getUserFromSession()` (verifies the JWT against Supabase Auth, then reads `profiles.role` via the admin client). Live test accounts are seeded by `npm run seed-live-accounts` (admin@test / dispatcher@test / driver@test, shared password `test1234`). Consequences today: `createRealAuthService().getCurrentUser()` still throws a scoped error because no consumer reaches it — the real-mode login/logout path sidesteps `AuthService` entirely. A follow-up ("retire AuthService interface") will delete `interfaces/auth.ts` + `interfaces/auth.real.ts` + `mocks/auth.ts` once mock mode also routes through `@supabase/ssr` (out of scope today). Known architectural choice: `readSessionFromRequest` parses the Supabase access-token JWT in middleware WITHOUT verifying its signature — acceptable because every server page re-checks authoritatively via `getUserFromSession()`. Admin driver-create flow remains wired on the real adapter: `createDriver` issues `supabase.auth.admin.createUser` → `profiles` insert → `drivers` insert with best-effort rollback. Every newly-created driver still gets a shared temporary password (`"test1234"`) — follow-up replaces with a random password + password-reset email. Dispatcher UI reads `driver_locations` as a static snapshot; Supabase Realtime subscription wires in a future feature.

### [mapbox] Mapbox access token
**Type:** API key
**Needed for:** geocoding office addresses, computing routes for the dispatcher, driver ETAs, rendering the dispatcher live map
**What to provide:** `NEXT_PUBLIC_MAPBOX_TOKEN`
**Where it plugs in:** `interfaces/maps.ts` (real adapter); dispatcher map page (`app/dispatcher/map/page.tsx`) currently renders a table + callout explaining the deferral.
**Workaround in place:** `mocks/maps.ts` — deterministic fake `geocode` (base `(40.0, -74.0)` + sum-of-char-codes offset), `routeFor` returns `stops.length * 1000 m` / `stops.length * 120 s` and a synthetic polyline, `etaFor` uses inline haversine distance × 60 sec/km. Dispatcher map page lists driver rows instead of rendering a real map; unblocks when `MAPBOX_TOKEN` is set and the Mapbox GL JS client is integrated.
  - Driver stop detail page `/driver/route/[stopId]` currently renders address + "Open in Maps" Google Maps deep link; inline Mapbox route view lands with the Mapbox integration feature.

## Resolved

### [twilio-sms] Twilio SMS credentials — **Status: DONE (real adapter shipped).**
**Type:** API key + account
**Needed for:** pickup SMS intake, driver SMS notifications, dispatcher send
**What to provide:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
**Where it plugs in:** real adapter lives in `interfaces/sms.real.ts` (`"server-only"`); tests in `interfaces/sms.real.test.ts`. The three env vars are still required at runtime but are no longer a build blocker — `createRealSmsService().sendSms()` throws `NotConfiguredError` with a friendly message when any are missing. `interfaces/sms.ts` re-exports `createRealSmsService` from the `"server-only"` module; callers' imports are unchanged. Inbound webhook receiver + `X-Twilio-Signature` verification remain deferred (STEP 4 of the SMS integration) and will land alongside the inbound route at `app/api/twilio/sms/route.ts`.
**Workaround in place:** `mocks/sms.ts` stores sends in an in-memory array with deterministic ids (`sms-mock-0`, `sms-mock-1`, …); `getSent()` returns the log for assertions. Kept as-is for `USE_MOCKS=true` pipeline tests.

### [anthropic] Anthropic API key — **Status: DONE (real adapter shipped).**
**Type:** API key
**Needed for:** parsing free-text pickup messages into structured fields (urgency, sample count, special instructions, confidence)
**What to provide:** `ANTHROPIC_API_KEY`
**Where it plugs in:** real adapter lives in `interfaces/ai.real.ts` (`"server-only"`); tests in `interfaces/ai.real.test.ts`. `ANTHROPIC_API_KEY` is still required at runtime but is no longer a build blocker — `createRealAiService()` throws `NotConfiguredError` with a friendly message when the var is missing. `interfaces/ai.ts` re-exports `createRealAiService` from the `"server-only"` module; callers' imports are unchanged.
**Workaround in place:** `mocks/ai.ts` — keyword heuristic: `"stat"` → `stat`, `"urgent"/"asap"/"rush"` → `urgent`, otherwise `routine`; first 1–99 integer becomes `sampleCount`; anything after the first newline becomes `specialInstructions`; confidence starts at 0.9 and drops 0.2 per missing signal (floor 0.5). Kept as-is for `USE_MOCKS=true` pipeline tests.

## Pattern

When adding an entry, use this shape:

```
### [slug] Short title
**Type:** API key | account | decision | other
**Needed for:** which feature(s) this unblocks
**What to provide:** exact variable names, service, or decision
**Where it plugs in:** file path(s) and env-var name(s)
**Workaround in place:** what the mock does today
```
