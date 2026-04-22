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
**Where it plugs in:** `interfaces/storage.ts` and `interfaces/auth.ts` (both real adapters throw referencing `NEXT_PUBLIC_SUPABASE_URL` — see `BLOCKERS.md` for the full triple)
**Workaround in place:** `mocks/storage.ts` uses in-memory `Map`s for offices/drivers/doctors/pickup_requests; `mocks/auth.ts` uses three seeded accounts (`driver@test`, `dispatcher@test`, `admin@test`, shared password `test1234`). The `ld_session` cookie set by `lib/session.ts` is base64 JSON — explicitly mock-grade; real Supabase Auth will replace this with its own cookies (sb-* access/refresh tokens) when wiring lands, and `lib/session.ts` will be rewritten or removed.

### [mapbox] Mapbox access token
**Type:** API key
**Needed for:** geocoding office addresses, computing routes for the dispatcher, driver ETAs
**What to provide:** `NEXT_PUBLIC_MAPBOX_TOKEN`
**Where it plugs in:** `interfaces/maps.ts` (real adapter)
**Workaround in place:** `mocks/maps.ts` — deterministic fake `geocode` (base `(40.0, -74.0)` + sum-of-char-codes offset), `routeFor` returns `stops.length * 1000 m` / `stops.length * 120 s` and a synthetic polyline, `etaFor` uses inline haversine distance × 60 sec/km.

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
