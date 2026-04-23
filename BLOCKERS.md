# Blockers

Things that require the user's accounts, API keys, or decisions before v1 can go to production. None of these block the autonomous local build (everything runs via mocks), but each must be resolved when the user returns.

## Unresolved

### [twilio-sms] Twilio SMS credentials
**Type:** API key + account
**Needed for:** pickup SMS intake, driver SMS notifications, dispatcher send
**What to provide:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
**Where it plugs in:** `interfaces/sms.ts` (real adapter); inbound webhook route (to be added with SMS intake feature)
**Workaround in place:** `mocks/sms.ts` stores sends in an in-memory array with deterministic ids (`sms-mock-0`, `sms-mock-1`, …); `getSent()` returns the log for assertions.

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
**Where it plugs in:** real storage adapter lives in `interfaces/storage.real.ts` with the shared admin client in `interfaces/supabase-client.ts` (both `"server-only"`); `interfaces/storage.ts` re-exports `createRealStorageService` so callers keep the existing import path. Real auth adapter now lives in `interfaces/auth.real.ts` (`"server-only"`); `interfaces/auth.ts` re-exports `createRealAuthService`. The storage + auth adapters both use `SUPABASE_SERVICE_ROLE_KEY` server-side (bypasses RLS; RLS policies land in their own feature).
**Workaround in place:** `mocks/storage.ts` uses in-memory `Map`s for offices/drivers/doctors/pickup_requests; `mocks/auth.ts` uses three seeded accounts (`driver@test`, `dispatcher@test`, `admin@test`, shared password `test1234`). Interface-level Supabase adapters are complete — the remaining work is the cookie rewire (STEP 4 in INTEGRATION_REPORT.md) which must precede any real multi-user deployment: the `ld_session` cookie set by `lib/session.ts` is base64 JSON — explicitly mock-grade; real Supabase Auth will replace this with its own cookies (sb-* access/refresh tokens) when wiring lands, and `lib/session.ts` will be rewritten or removed. Consequences today: `createRealAuthService().getCurrentUser()` throws a scoped `"requires the cookie migration (STEP 4)"` error because the admin client holds no persistent user session; no consumer reaches it (every session resolver goes through `lib/session.ts::getSession()`). `createRealAuthService().signOut()` is a best-effort no-op for the same reason (user-visible logout still happens via `clearSession()` in `app/logout/route.ts`). Admin driver-create flow is now fully wired on the real adapter: `createDriver` issues `supabase.auth.admin.createUser` → `profiles` insert → `drivers` insert with best-effort rollback (non-transactional across auth+Postgres; if a rollback-delete itself fails a `console.warn` is logged and the orphaned `auth.users` row requires manual cleanup via Supabase — acceptable at v1; a Postgres RPC wrapping all three steps atomically is a future follow-up). Every newly-created driver gets a shared temporary password (`"test1234"`) — acceptable for v1 dev/staging; a follow-up ("driver onboarding flow") will replace with a random password + immediate password-reset email. Dispatcher UI reads `driver_locations` as a static snapshot; real Supabase Realtime subscription wires in a future feature.

### [mapbox] Mapbox access token
**Type:** API key
**Needed for:** geocoding office addresses, computing routes for the dispatcher, driver ETAs, rendering the dispatcher live map
**What to provide:** `NEXT_PUBLIC_MAPBOX_TOKEN`
**Where it plugs in:** `interfaces/maps.ts` (real adapter); dispatcher map page (`app/dispatcher/map/page.tsx`) currently renders a table + callout explaining the deferral.
**Workaround in place:** `mocks/maps.ts` — deterministic fake `geocode` (base `(40.0, -74.0)` + sum-of-char-codes offset), `routeFor` returns `stops.length * 1000 m` / `stops.length * 120 s` and a synthetic polyline, `etaFor` uses inline haversine distance × 60 sec/km. Dispatcher map page lists driver rows instead of rendering a real map; unblocks when `MAPBOX_TOKEN` is set and the Mapbox GL JS client is integrated.
  - Driver stop detail page `/driver/route/[stopId]` currently renders address + "Open in Maps" Google Maps deep link; inline Mapbox route view lands with the Mapbox integration feature.

## Resolved

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
