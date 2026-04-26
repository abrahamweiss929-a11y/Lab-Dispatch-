# Doctor-communication audit — current state

Audit-only. No code changed. Branch: `main` (tip `9f64ea8`).

Two cross-cutting things to know up front:

- **Mock vs. real-mode toggle:** every adapter is selected at runtime by `USE_MOCKS`. `USE_MOCKS=true` (or unset) wires the in-memory mocks; `USE_MOCKS=false` wires the real adapters. With `USE_MOCKS=false`, an unset env var doesn't crash the app — `createRealEmailService` / `createRealSmsService` throw a typed `NotConfiguredError` only on the first call.
- **Signature verification is not implemented anywhere.** Both inbound webhooks accept any HTTP POST. The TODOs are flagged at [app/api/sms/inbound/route.ts:8-10](app/api/sms/inbound/route.ts:8) and [app/api/email/inbound/route.ts:18-21](app/api/email/inbound/route.ts:18). Until they're added, the rate-limit bucket (`smsInboundBucket` / `emailInboundBucket`) is the only abuse guard.

---

## Inbound (doctor → us)

### 1. Web pickup form `/pickup/[slugToken]`

**Status: ✅ Working end-to-end** (mock storage; real Supabase too once `USE_MOCKS=false`).

- Route + form: [app/pickup/[slugToken]/page.tsx](app/pickup/%5BslugToken%5D/page.tsx) and [_components/PickupRequestForm.tsx](app/pickup/%5BslugToken%5D/_components/PickupRequestForm.tsx).
- Server action: [app/pickup/[slugToken]/actions.ts](app/pickup/%5BslugToken%5D/actions.ts:22) — validates slug-token, rate-limits via `pickupFormBucket`, validates length/urgency/sample count, resolves the office via `findOfficeBySlugToken`, persists a `PickupRequest`, then *attempts* an auto-confirmation email (best-effort; see #7).
- No signature/captcha — the slug-token itself is the unguessable secret per design; rate limiter is the only abuse guard.

### 2. SMS inbound (Twilio → us)

**Status: ⚠️ Code exists, needs production hardening.**

- Route handler: [app/api/sms/inbound/route.ts](app/api/sms/inbound/route.ts) parses Twilio's `application/x-www-form-urlencoded` body (`From`, `Body`), rate-limits per sender, then hands off to [`handleInboundMessage`](lib/inbound-pipeline.ts:48). The pipeline normalizes the phone, finds an office via `storage.findOfficeByPhone`, runs Anthropic to extract urgency/sample count, persists a `Message` + `PickupRequest`, then auto-replies via `sms.sendSms` with one of `UNKNOWN_SENDER_COPY` / `FLAGGED_ACK_COPY` / `receivedCopy(...)`.
- Tests: [app/api/sms/inbound/route.test.ts](app/api/sms/inbound/route.test.ts) plus [lib/inbound-pipeline.test.ts](lib/inbound-pipeline.test.ts).
- **What's missing for production:**
  1. **`X-Twilio-Signature` verification.** TODO at [route.ts:8-10](app/api/sms/inbound/route.ts:8). Without it any third party can POST forged inbound SMS to your endpoint.
  2. **Webhook URL configuration in the Twilio console** — point the messaging service / phone number to `https://<your-domain>/api/sms/inbound`. Not tracked anywhere in the repo; this is a Twilio-side action.
  3. **Env vars** for outbound replies issued from the same handler: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` ([sms.real.ts:45-65](interfaces/sms.real.ts:45)). All three are documented as already provisioned per `BLOCKERS.md` (resolved [twilio-sms]).
  4. `USE_MOCKS=false` so real-mode adapters get loaded.

### 3. Email inbound (Postmark → us)

**Status: ⚠️ Webhook handler exists; outbound adapter does not.**

- Route handler: [app/api/email/inbound/route.ts](app/api/email/inbound/route.ts) parses Postmark JSON (`From`, `Subject`, `TextBody`/`HtmlBody`), rate-limits, calls `handleInboundMessage`. So **inbound parsing works end-to-end through `handleInboundMessage`** in `USE_MOCKS=true` (replies via `emailMock`).
- **What's blocking it from working in production:**
  1. **No real Postmark adapter.** [interfaces/email.ts:30-39](interfaces/email.ts:30) — `createRealEmailService().sendEmail` always throws `NotConfiguredError`. So in `USE_MOCKS=false` the webhook accepts the inbound message (stores it) but the auto-reply step inside the pipeline crashes the request after persisting (caught by the route's outer `try/catch`, returns `{status:"error"}` 200).
  2. **No `X-Postmark-Signature` (or path-secret) check.** TODO at [route.ts:18-21](app/api/email/inbound/route.ts:18).
  3. **Env vars not wired:** `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL`, `POSTMARK_INBOUND_SECRET` (per `BLOCKERS.md` [inbound-email]).
  4. **Postmark inbound webhook URL** has to be configured in the Postmark dashboard to POST to `https://<your-domain>/api/email/inbound`.

---

## Outbound (us → doctor)

### 4. SMS confirmation when pickup is confirmed

**Status: ⚠️ Wired into the inbound SMS pipeline only.**

- The inbound pipeline auto-replies via SMS with `receivedCopy(...)` ([inbound-pipeline.ts:113-116](lib/inbound-pipeline.ts:113)) — i.e. when a doctor texts in, they get a confirmation SMS back. This works once Twilio creds + `USE_MOCKS=false` are set.
- **Web-form submissions do NOT send a confirmation SMS.** [app/pickup/[slugToken]/actions.ts](app/pickup/%5BslugToken%5D/actions.ts:107-132) only sends an email confirmation, and only if `office.email` is set. There is no `sms.sendSms` call on this path.
- Dispatcher manually accepting/assigning a request also does NOT send any SMS — verified by grep: no `sendSms` call in `app/dispatcher/routes/actions.ts` or `app/driver/route/actions.ts`.

### 5. SMS heads-up when driver is ~10 min away

**Status: ✅ Working end-to-end** (with the same Twilio creds + `USE_MOCKS=false` requirement).

- Implementation: [lib/heads-up.ts](lib/heads-up.ts) — fires from `recordLocationAction` after each driver GPS sample. Threshold is 12 min ([HEADS_UP_THRESHOLD_SECONDS](lib/heads-up.ts:46)). One-shot per stop via `markStopNotified10min`. Body is the constant `"Your sample pickup is ~10 minutes away."` ([HEADS_UP_COPY](lib/heads-up.ts:49)).
- Skip-reasons enumerated in the [`HeadsUpOutcome`](lib/heads-up.ts:25) union; tests in [lib/heads-up.test.ts](lib/heads-up.test.ts).
- **Caveat:** "N minutes" is fixed at ~10 in copy and 12 in threshold; not configurable per-office.

### 6. SMS when pickup is completed

**Status: ❌ Not implemented.**

- `completeRouteAction` ([app/driver/actions.ts:29](app/driver/actions.ts:29)) and `markStopPickedUp` (in [app/driver/route/actions.ts](app/driver/route/actions.ts)) update storage and revalidate paths — neither calls `sms.sendSms`. Confirmed via grep: no `sendSms` reference in any driver/route/dispatcher action file outside of the heads-up call chain.
- No "stop completed" or "route completed" copy constant exists anywhere in `lib/`.

### 7. Email versions of #4 / #5 / #6

| Surface | Status |
|---|---|
| **Email confirmation on web-form submission** | ⚠️ Code path exists but adapter is unimplemented. [actions.ts:122-132](app/pickup/%5BslugToken%5D/actions.ts:122) calls `services.email.sendEmail(...)` inside a `try/catch` that swallows failures. In mock mode the mail lands in `emailMock`'s in-memory log and the pickup persists. In real mode (`USE_MOCKS=false`) the call throws `NotConfiguredError`, the catch swallows it, the request is still persisted but no email is actually sent. |
| **Email confirmation on inbound email pipeline** | ⚠️ Same shape — [inbound-pipeline.ts:79-85, 117-123](lib/inbound-pipeline.ts:79) calls `email.sendEmail` for unknown-sender and known-sender flows; works under mocks, fails in real mode until the Postmark adapter exists. |
| **Email heads-up (10-min)** | ❌ Not implemented. `lib/heads-up.ts` only sends SMS. No email branch. |
| **Email when pickup completed** | ❌ Not implemented. Same gap as #6. |

---

## Summary table

| # | Feature | Status | Real-mode blocker |
|---|---|---|---|
| 1 | Web pickup form | ✅ | — |
| 2 | SMS inbound | ⚠️ | Twilio signature verification + console webhook URL setup |
| 3 | Email inbound | ⚠️ | Postmark adapter + signature check + console webhook URL + env vars |
| 4 | SMS confirmation (inbound SMS path) | ⚠️ | Twilio creds + `USE_MOCKS=false` (creds exist; flag is a deploy flip) |
| 4b | SMS confirmation (web form / dispatcher accept) | ❌ | Not implemented |
| 5 | SMS 10-min heads-up | ⚠️ | Same as #4 — needs `USE_MOCKS=false` |
| 6 | SMS on completion | ❌ | Not implemented |
| 7 | Email versions of 4/5/6 | ❌ / ⚠️ | Postmark adapter missing; only confirmation paths even attempt to call email today |

## Smallest path to "fully wired in production"

1. Add Twilio signature verification + Postmark webhook auth to the two `/api/.../inbound/route.ts` files (security, not features).
2. Implement [interfaces/email.ts](interfaces/email.ts:30) `createRealEmailService` against Postmark — the call sites already exist and are guarded by `try/catch`.
3. Set `USE_MOCKS=false` in the production env, add Postmark vars, configure both webhook URLs in their respective consoles.
4. (Optional, separate feature) decide whether you want web-form submissions to also send SMS, and whether route/stop completion should notify the doctor at all.
