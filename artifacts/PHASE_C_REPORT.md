# Phase C Report — SMS Production Hardening

Branch: `feat/sms-production` (off `main`).

## Goal

Three pieces:
1. Authenticate inbound Twilio webhooks (HMAC-SHA1 signature check).
2. Send an outbound SMS confirmation when a web-form pickup request is
   submitted.
3. Send an outbound SMS notification when a driver marks a stop picked
   up.

Plus: a real Twilio setup runbook in `artifacts/TWILIO_SETUP.md`.
Email is deliberately out of scope.

## What changed

### New files

- `lib/twilio-signature.ts` — `computeTwilioSignature`,
  `verifyTwilioSignature`, `reconstructWebhookUrl`. Uses Node `crypto`
  (`createHmac("sha1", token)`, `timingSafeEqual`). Honors
  `x-forwarded-proto` / `x-forwarded-host` for the URL Twilio actually
  signed.
- `lib/twilio-signature.test.ts` — 12 tests: algorithm correctness,
  ordering invariance, URL/body sensitivity, header missing/empty,
  tamper detection, wrong token, length-mismatch short-circuit, proxy
  header reconstruction.
- `artifacts/TWILIO_SETUP.md` — env vars, console webhook config,
  proxy notes, rotation guidance, list of outbound trigger points,
  compliance notes.

### Modified files

- `app/api/sms/inbound/route.ts` — was: parse form, rate-limit, call
  pipeline. Now: read `TWILIO_AUTH_TOKEN` (503 if unset), parse the raw
  form ourselves, reconstruct the public URL, verify
  `X-Twilio-Signature` (403 on failure), then continue with the
  existing rate-limit + pipeline path.
- `app/api/sms/inbound/route.test.ts` — added 4 signature tests
  (missing header, wrong header, tampered body, missing token →
  503), updated all happy-path tests to sign the request via the
  shared `computeTwilioSignature` helper.
- `app/pickup/[slugToken]/actions.ts` — after the existing
  best-effort confirmation email, send a best-effort confirmation SMS
  when `office.phone` is present. Body matches the spec wording and
  includes "Reply STOP to opt out".
- `app/pickup/[slugToken]/actions.test.ts` — 2 new tests: SMS sent
  when phone present (asserts body contains office name + ETA + STOP),
  no SMS when phone absent.
- `app/driver/route/actions.ts` — `pickupStopAction` now resolves the
  originating office (via `getPickupRequest` → `getOffice`) and sends
  a best-effort SMS notification when the office has a phone. Wrapped
  in try/catch so a Twilio outage cannot roll back the pickup.
- `app/driver/route/actions.test.ts` — 3 new tests: SMS sent on happy
  path, no SMS when phone absent, transient SMS failure swallowed
  (pickup still succeeds).

## Tests

```
Test Files  58 passed (58)
     Tests  721 passed (721)
```

Phase C added **21** tests on top of the 700-test baseline. `tsc
--noEmit` clean.

## Manual setup required before going live

1. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
   in the production env.
2. Set `USE_MOCKS=false`.
3. In the Twilio console, point the production phone number's
   "A MESSAGE COMES IN" webhook at
   `https://<host>/api/sms/inbound` (HTTP POST, urlencoded).
4. If running behind a proxy, ensure `x-forwarded-proto` and
   `x-forwarded-host` reach the route — otherwise the URL the route
   reconstructs won't match the URL Twilio signed and every webhook
   will 403.

See `artifacts/TWILIO_SETUP.md` for the full runbook.

## Out of scope (intentional)

- Email production hardening (Postmark / inbound parse). Same seams
  exist in `interfaces/email.ts`; will be a separate pass.
- Per-office STOP/opt-out tracking. Twilio handles
  STOP/HELP/UNSTOP at the carrier level for us; storing the
  consent state for our own records is a separate feature.
- Status-callback widening (`SmsSendResult.status` stays `"queued"`).

## Commit

Single commit on this branch — see `feat(sms): twilio inbound
signature verification + outbound confirmations`.
