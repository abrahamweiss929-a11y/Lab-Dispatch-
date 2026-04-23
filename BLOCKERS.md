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
**Where it plugs in:** real storage adapter lives in `interfaces/storage.real.ts` with the shared admin client in `interfaces/supabase-client.ts` (both `"server-only"`); `interfaces/storage.ts` re-exports `createRealStorageService` so callers keep the existing import path. Real auth adapter still pending — `interfaces/auth.ts` continues to throw `NotConfiguredError` referencing `NEXT_PUBLIC_SUPABASE_URL`. The storage adapter uses `SUPABASE_SERVICE_ROLE_KEY` server-side (bypasses RLS; RLS policies land in their own feature).
**Workaround in place:** `mocks/storage.ts` uses in-memory `Map`s for offices/drivers/doctors/pickup_requests; `mocks/auth.ts` uses three seeded accounts (`driver@test`, `dispatcher@test`, `admin@test`, shared password `test1234`). The `ld_session` cookie set by `lib/session.ts` is base64 JSON — explicitly mock-grade; real Supabase Auth will replace this with its own cookies (sb-* access/refresh tokens) when wiring lands, and `lib/session.ts` will be rewritten or removed. Admin driver-create flow: the real storage adapter's `createDriver` throws a scoped `"createDriver requires the Supabase auth adapter"` error today — full driver creation (`supabase.auth.admin.createUser` + `profiles` insert + `drivers` insert in a transaction) is owned by the auth adapter feature. Every other storage method on the real adapter is fully wired. Dispatcher UI reads `driver_locations` as a static snapshot; real Supabase Realtime subscription wires in a future feature.

### [mapbox] Mapbox access token
**Type:** API key
**Needed for:** geocoding office addresses, computing routes for the dispatcher, driver ETAs, rendering the dispatcher live map
**What to provide:** `NEXT_PUBLIC_MAPBOX_TOKEN`
**Where it plugs in:** `interfaces/maps.ts` (real adapter); dispatcher map page (`app/dispatcher/map/page.tsx`) currently renders a table + callout explaining the deferral.
**Workaround in place:** `mocks/maps.ts` — deterministic fake `geocode` (base `(40.0, -74.0)` + sum-of-char-codes offset), `routeFor` returns `stops.length * 1000 m` / `stops.length * 120 s` and a synthetic polyline, `etaFor` uses inline haversine distance × 60 sec/km. Dispatcher map page lists driver rows instead of rendering a real map; unblocks when `MAPBOX_TOKEN` is set and the Mapbox GL JS client is integrated.
  - Driver stop detail page `/driver/route/[stopId]` currently renders address + "Open in Maps" Google Maps deep link; inline Mapbox route view lands with the Mapbox integration feature.

### [anthropic] Anthropic API key
**Type:** API key
**Needed for:** parsing free-text pickup messages into structured fields (urgency, sample count, special instructions, confidence)
**What to provide:** `ANTHROPIC_API_KEY`
**Where it plugs in:** `interfaces/ai.ts` (real adapter)
**Workaround in place:** `mocks/ai.ts` — keyword heuristic: `"stat"` → `stat`, `"urgent"/"asap"/"rush"` → `urgent`, otherwise `routine`; first 1–99 integer becomes `sampleCount`; anything after the first newline becomes `specialInstructions`; confidence starts at 0.9 and drops 0.2 per missing signal (floor 0.5).

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
