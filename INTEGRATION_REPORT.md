# Lab Dispatch — Integration Report

**Integration window:** 2026-04-22
**Status:** ✅ All 5 real adapters wired. Session cookie migrated to Supabase Auth. RLS live on the Supabase project. 659 tests green.

---

## What's connected

| Service | Package | Real adapter | Smoke |
|---|---|---|---|
| Supabase Postgres | `@supabase/supabase-js` | [interfaces/supabase-client.ts](interfaces/supabase-client.ts) + [interfaces/storage.real.ts](interfaces/storage.real.ts) | ✅ `listOffices` round-trip |
| Supabase Auth (user sessions) | `@supabase/ssr` | [lib/supabase-server.ts](lib/supabase-server.ts) + [lib/supabase-middleware.ts](lib/supabase-middleware.ts) + [interfaces/auth.real.ts](interfaces/auth.real.ts) | ✅ test accounts seeded; login flow probed via curl |
| Anthropic Claude | `@anthropic-ai/sdk` | [interfaces/ai.real.ts](interfaces/ai.real.ts) (`claude-haiku-4-5-20251001`) | ✅ `confidence=0.95 urgency=routine sampleCount=2` on a real parse |
| Mapbox | built-in `fetch` (no SDK) | [interfaces/maps.real.ts](interfaces/maps.real.ts) | ✅ geocoded "1600 Pennsylvania Ave" → `(38.8792, -76.9819)` |
| Twilio | `twilio` | [interfaces/sms.real.ts](interfaces/sms.real.ts) | ✅ account fetch `status=active friendlyName=lab` |
| Postmark | — | deferred, stub in [interfaces/email.ts](interfaces/email.ts) | ⚠️ not wired — see blockers |

**Selector:** `interfaces/index.ts` reads `process.env.USE_MOCKS`. Set to `"false"` in `.env.local` — the app uses real adapters. Flip to `"true"` (or unset) to revert to deterministic mocks (useful for local dev without network).

**Session strategy:** dual-mode. Under `USE_MOCKS=true`, the original base64-JSON `ld_session` cookie + seeded `mocks/auth.ts` accounts still work — nothing regressed. Under `USE_MOCKS=false`, Supabase Auth sets its own `sb-*` cookies via `@supabase/ssr`, and we write a coarse `ld_role` cookie so Edge middleware can allow/deny without a DB roundtrip. Every server page re-validates the role authoritatively via `supabase.auth.getUser()` + a `profiles` lookup, so a forged `ld_role` cookie fails at the page level.

---

## Quality gate (final)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` | ✅ 0 warnings / 0 errors |
| `npm test -- --run` | ✅ **659 / 659** tests across 53 files |
| `npm run build` | ✅ 28 routes compiled, middleware 85 kB |
| `npm run smoke-check` | ✅ 4/4 real adapters OK |
| `npm run seed-live-accounts` | ✅ 3 accounts (admin@test, dispatcher@test, driver@test) present |
| `npm run apply-rls-policies` | 📋 prints SQL for manual paste (no `pg` dep added) |
| Dev-server middleware probe | ✅ `/login` 200, `/admin` + `/dispatcher` + `/driver` redirect to `/login?next=...`, `/pickup/…` public |

Tests count by module (rough):
- Unit (lib, interfaces, mocks, actions): 659
- Integration: none yet
- E2E / browser: none yet (Playwright not installed)

**No real API calls in any test** — every adapter test mocks its SDK via `vi.mock` or mocks `global.fetch`. The only live-service touchpoints are the two manual scripts: `smoke-check` and `seed-live-accounts`.

---

## Git layout

Every adapter ships on its own `feature/adapter-*` branch, plus one combined integration branch. All branches are on origin.

| Branch | Tip | Purpose |
|---|---|---|
| `feature/adapter-supabase-storage` | `541d47a` | real Postgres adapter |
| `feature/adapter-supabase-auth` | `1a7c30b` | real Auth adapter + `createDriver` wired |
| `feature/adapter-anthropic-ai` | `f3e3c58` | real Claude parser |
| `feature/adapter-mapbox-maps` | `d75ae5c` | real Mapbox adapter |
| `feature/adapter-twilio-sms` | `54f9afb` | real Twilio adapter |
| `feature/integration-smoke-check` | `223985c` | fence-fix, smoke-check, session migration, RLS policies |

`main` still points at the v1 build tip (`28bcca6`). None of the integration work has been fast-forwarded into `main` — you choose when to merge.

---

## How to run the app now

**Development:**
```bash
# Use real adapters (default from .env.local)
npm run dev
# → http://localhost:3000

# Sign in at /login — the three seeded accounts all have password test1234:
#   admin@test       → lands on /admin
#   dispatcher@test  → lands on /dispatcher
#   driver@test      → lands on /driver
```

**Use mocks for offline dev** (no network needed):
```bash
USE_MOCKS=true npm run dev
# ...or edit .env.local
```

**Verify live services:**
```bash
npm run smoke-check           # one round-trip per service
npm run seed-live-accounts    # idempotent; prints OK or SKIPPED per account
```

**Production build:**
```bash
npm run build && npm start
```

---

## What you need to provide next (the remaining blockers)

Only one service is still on mocks:

### 1. Postmark (or SendGrid) — inbound + outbound email

**Why:** `/api/email/inbound` and every outbound auto-reply are still no-ops against the mock. Email-channel pickups won't flow until this is wired.

**What I need from you:** `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL`, `POSTMARK_INBOUND_SECRET` (or the SendGrid equivalents + tell me which).

**Effort:** ~1 hour to mirror the Twilio adapter pattern.

### 2. Twilio webhook signature verification

The real Twilio adapter sends SMS fine, but `/api/sms/inbound` does NOT yet verify the `X-Twilio-Signature` header. Any caller that knows the URL can POST fake inbound messages. Same gap for the Postmark inbound webhook when it lands.

**Effort:** ~30 min — `twilio.validateRequest(authToken, signature, url, params)` in the route handler.

### 3. Driver-onboarding password flow

`storage.real.createDriver` currently sets a shared temporary password (`test1234`). Before any real driver accounts are created in production, swap to a random password + immediate password-reset email. Tracked in BLOCKERS under `[driver-onboarding]`.

### 4. Mapbox UI

The real Mapbox *adapter* is wired (geocoding + directions work server-side). The `/dispatcher/map` page still renders a placeholder table — the actual `<Map>` React component hasn't been built. Deferred because it's a UI refresh, not an integration task.

### 5. Realtime subscriptions

`/dispatcher/map` polls on refresh today. To get live driver-location updates, wire Supabase Realtime (`supabase.channel('driver_locations').on(...)`). Deferred; flagged in BLOCKERS `[supabase]`.

### 6. RLS policy behavior in production

Every user-session query now goes through the policies you just pasted. If a role experiences "I see zero rows" symptoms:
- `admin@test` should see everything (catch-all admin policies)
- `dispatcher@test` sees a 30-day window on pickup_requests + routes (older-than-30d completed records are hidden)
- `driver@test` sees only their own routes/stops and the offices behind them

If something unexpectedly empty appears, grab the browser's network tab and look for a row-count mismatch. The service-role script paths (`seed-live-accounts`, `smoke-check`, anything that calls `interfaces/storage.real.ts`) bypass RLS entirely — they won't hit these limits.

---

## Open blockers

See [BLOCKERS.md](BLOCKERS.md) for full details. Summary:

- **Resolved:** `[supabase]` (storage + auth both wired), `[anthropic]`, `[mapbox]`, `[twilio-sms]`
- **Unresolved:** `[inbound-email]` (Postmark creds needed), `[driver-onboarding]` (password flow), webhook signature verification (tracked inline in the route handlers as `TODO(blockers:*)`)

No unresolved build failures. No adapter fell the 3-strikes threshold.

---

## What changed in this integration pass (by the numbers)

- **7 integration commits** across ~85 files
- **+2046 / −164 lines** in production code; **+3241 / −56** in tests
- **+16 npm deps** (transitively; `@supabase/supabase-js` + `@supabase/ssr` + `@anthropic-ai/sdk` + `twilio` + `tsx` + `server-only`)
- **+122 tests** added (537 → 659)
- **0 debug cycles** burned beyond the planned loops; 1 review cycle on `adapter-supabase-storage` (none required a fix)
- **1 real bug caught by smoke-check**: Anthropic returns markdown-fenced JSON; adapter was parsing raw. Fixed in `5974c15` with 4 regression tests.

---

## Suggested next steps (priority order)

1. **Run the app, sign in as each role, click around.** The automated gate catches regressions at the unit level but not UI affordance. Expect to find UI copy or layout issues that didn't matter against mocks but show up now (e.g., empty-state text when the live DB has 0 rows).
2. **Create an office via `/admin/offices/new`** to get the end-to-end pickup flow working. Then visit the generated `/pickup/{slug-token}` URL and submit a request.
3. **Wire Postmark** (the last blocker). Follow the Twilio adapter as the template.
4. **Add webhook signature verification** on `/api/sms/inbound` and (when Postmark lands) `/api/email/inbound`.
5. **Deploy to Vercel** — the `.env.local` keys need to migrate to the Vercel project env. `USE_MOCKS=false` in prod; mocks remain available for PR previews if you want.
6. **Set up Playwright or similar** and write the three golden-path smoke flows (admin create driver, dispatcher assign request to route, driver arrives + picks up).
7. **Retire the `AuthService` interface + `mocks/auth.ts`** once mock mode is no longer needed for local dev. The whole `@supabase/ssr` path can be the single source of truth.

---

Thanks. The mock → real swap landed cleanly. Every service round-trips. Everything still runs with `USE_MOCKS=true` if you need an offline dev loop. Ball's in your court for Postmark + the UI-level smoke.
