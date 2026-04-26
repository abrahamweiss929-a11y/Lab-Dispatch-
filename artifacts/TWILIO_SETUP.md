# Twilio Setup

How to wire a real Twilio account into Lab Dispatch in production.

## Required environment variables

The real SMS adapter (`interfaces/sms.real.ts`) and the inbound webhook
route (`app/api/sms/inbound/route.ts`) read these at runtime. Missing
values fail closed — outbound calls throw `NotConfiguredError`; inbound
POSTs return `503 not_configured`.

| Variable | Where it's used | Notes |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | outbound | Starts with `AC…` |
| `TWILIO_AUTH_TOKEN` | outbound + inbound signature verification | True secret. Server-only. Rotate via the Twilio console — never commit. |
| `TWILIO_FROM_NUMBER` | outbound | E.164 (`+15551234567`); the number must be SMS-enabled and owned by your Twilio account. |
| `USE_MOCKS` | global toggle | Set to `false` in production so `getServices()` returns the real adapter. |

## Inbound webhook configuration

In the Twilio console:

1. **Phone Numbers → Manage → Active Numbers → click your number.**
2. Under **Messaging Configuration**:
   - **A MESSAGE COMES IN** → Webhook → `https://YOUR_HOST/api/sms/inbound`
   - HTTP method: **`HTTP POST`** (form-urlencoded; this is the default).
3. Save.

The route verifies `X-Twilio-Signature` (HMAC-SHA1 of the URL plus
sorted POST `key+value` pairs, base64-encoded) against
`TWILIO_AUTH_TOKEN`. Requests without a valid signature are rejected
with **403** before any storage write or pipeline call.

### Behind a proxy / load balancer

The signature is computed against the URL Twilio called (the public
URL), not `req.url` (which may be the internal URL). The route
reconstructs the public URL from `x-forwarded-proto` + `x-forwarded-host`
when those headers are present. If your proxy strips them, configure it
to forward both, or terminate TLS at the same host Twilio dials.

### After rotating the auth token

Twilio supports an old-token grace window during rotation. After the new
token is live in `TWILIO_AUTH_TOKEN` and deployed, immediately revoke
the old one in the Twilio console — the route only checks against the
single value in env, so the grace window does not extend to us.

## Outbound trigger points

Two production paths send SMS today (both swallow Twilio errors so the
underlying business action is never rolled back by a transient outage):

| Trigger | File | When | Body |
|---|---|---|---|
| Web-form pickup request created | `app/pickup/[slugToken]/actions.ts` | After the request is persisted, if `office.phone` is set | "Lab Dispatch: pickup request received for {office name}. Driver will arrive within about 2 hours. Reply STOP to opt out." |
| Stop marked picked up | `app/driver/route/actions.ts` | After `markStopPickedUp`, if the originating office has a phone | "Lab Dispatch: samples picked up from {office name} at {time}. En route to lab." |

The inbound auto-reply paths in `lib/inbound-pipeline.ts`
(`UNKNOWN_SENDER_COPY`, `FLAGGED_ACK_COPY`, `receivedCopy(...)`) are
unchanged.

## Testing the wiring without sending real SMS

- Local dev: keep `USE_MOCKS=true` (or unset). All SMS calls go to the
  in-memory `mocks/sms.ts` and are inspectable via `getSent()`.
- Production smoke test: send a single outbound to a number you own,
  then text the inbound number from that same phone and confirm the
  `messages` row + auto-reply path.

## Compliance notes

- The web-form confirmation includes "Reply STOP to opt out" per
  10DLC/A2P guidance.
- Twilio enforces STOP/HELP keywords automatically at the carrier level
  — we don't need to handle them in `handleInboundMessage`.
- The auth token, account SID, and message body are deliberately not
  logged anywhere. See the comment block at the top of
  `interfaces/sms.real.ts` for the exact PHI / credential boundary
  rules.

## Email is intentionally out of scope

This pass hardens SMS only. Inbound and outbound email continue to use
the existing mock-or-Postmark seam (`interfaces/email.ts`) and will be
addressed in a follow-up.
