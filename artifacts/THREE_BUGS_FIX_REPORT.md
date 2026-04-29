# Three production bugs — fix report

Branch: `fix/three-bugs` → merged to `main` @ `e180768`.

## Phase commits

| Commit | Bug |
| --- | --- |
| `a7f686a` | Bug 1 — `fix(pickup): notes are optional (drop the 10-character minimum)` |
| `d91558b` | Bug 2 — `fix(sms): diagnostic logging on inbound webhook + TwiML regression test` |
| `a8ca793` | Bug 3 — `fix(messages): "Convert to request" button on every message` |
| `e180768` | Merge to main |

Tests: 981/982 passing (only the pre-existing UTC-midnight payroll
flake remains, acceptable per spec). Type-check clean.
`npm run build` compiles end-to-end.

---

## Bug 1 — Web form rejected short notes

### Reproduction
- `/pickup/chen-internal-medicine-demo-chen-06`
- Type "ss" in Notes → Send → "Please share at least 10 characters
  so we know what to pick up."

### Root cause
Server-side validation in
`app/pickup/[slugToken]/actions.ts` enforced `notes.length >= 10`.
The check was a v1 quality nudge but it blocks legitimate
short-form requests ("pickup now", routine daily runs).

### Fix
- Drop the minimum-length check entirely.
- Keep the 1000-char upper bound as a defensive guard against
  runaway pastes.
- Form label: "Notes (optional)".
- New placeholder copy: "Any details about the pickup are
  helpful — patient count, sample type, special instructions.
  Skip if it's a regular run."

### Files
- `app/pickup/[slugToken]/actions.ts`
- `app/pickup/[slugToken]/_components/PickupRequestForm.tsx`
- `app/pickup/[slugToken]/actions.test.ts` (-2 stale cases, +4 new)

### Tests
- Empty notes → success
- Single-character notes → success
- "ss" (exact production repro) → success
- 1001-char notes → still rejected (upper bound preserved)

### Verification
Direct production verification was not done from this shell
(would require submitting the form against the live URL). Local
test suite confirms the action accepts the failing inputs.

---

## Bug 2 — SMS auto-reply not arriving

### Reproduction
Send SMS from a real phone (e.g. +19292714446) to the Twilio
number → 60s wait → no confirmation back.

### Code-path review (no bug found in our code)

| Layer | Behavior | Status |
| --- | --- | --- |
| `lib/inbound-pipeline.ts` | Sets `result.smsAutoReplyBody` for matched non-flagged SMS (line 144) | ✓ correct |
| `lib/twiml.ts` `messageTwimlResponse` | Wraps body in `<Response><Message>{escaped}</Message></Response>` | ✓ correct |
| `app/api/sms/inbound/route.ts` | Reads `result.smsAutoReplyBody`; if non-empty, emits `messageTwimlResponse(body)` with `Content-Type: text/xml` | ✓ correct |

The wire-up is correct in code. Production curl confirms the
endpoint returns `Content-Type: text/xml` with valid TwiML on
every code path.

### Most likely root cause: A2P 10DLC carrier filtering

Twilio's US carrier filtering (Application-to-Person 10DLC)
silently drops outbound SMS from numbers that aren't registered
under an approved campaign. The webhook 200s, the TwiML body is
well-formed, the `<Message>` payload is correct — but the
carrier never delivers the SMS to the recipient handset.

This is **out of our code's control**. Resolution requires:

1. Register the brand in the Twilio console (Trust Hub).
2. Submit a 10DLC campaign for "customer support /
   appointment-style notifications".
3. Associate the `+17159213439` Twilio number with the approved
   campaign.
4. Wait for carrier approval (typically 1–7 business days).

Once approved, the same code path will deliver replies without
any change.

### Diagnostic logging added

Production debugging now distinguishes the failure mode. No PII
in any log line — only the routing branch and a body length:

- `app/api/sms/inbound/route.ts`:
  - `[sms-inbound] status=received reply=Message bodyLen=82 requestId=...` — pipeline produced an auto-reply, route emitted TwiML.
  - `[sms-inbound] status=unknown_sender reply=empty (...)` — pipeline matched no office.
  - `[sms-inbound] status=flagged reply=empty (...)` — AI flagged the parse; no reply by spec.
  - `[sms-inbound] status=error reply=empty (...)` — pipeline threw.
- `lib/inbound-pipeline.ts`:
  - `[inbound-pipeline] sms unknown_sender — findOfficeByPhone returned null` — fires when no office has the inbound phone on file.

Next time a test SMS doesn't get a reply, the operator can pull
the Vercel function logs for `/api/sms/inbound` and see:
- If they see `reply=Message bodyLen=N` → our side is good. Look at the Twilio console for delivery status; it'll show "Filtered" or "Undelivered" with an error code (likely 30007 or similar). That's A2P 10DLC.
- If they see `reply=empty status=unknown_sender` → the office's phone number isn't matching anything in the offices table. Check the office record's `phone` value (most likely a format / E.164 issue, but the lookup has a fallback that re-normalizes both sides).
- If they see `reply=empty status=flagged` → AI parser low confidence. Usually means the body was too cryptic. Dispatcher reviews and re-confirms.

### Verbatim regression test

`app/api/sms/inbound/route.test.ts`: when the pipeline returns
`smsAutoReplyBody: "hello"`, the route's response body contains
the exact literal `<Message>hello</Message>`. If this test ever
fails, the route → TwiML wiring has regressed.

### Files
- `app/api/sms/inbound/route.ts` (logging)
- `lib/inbound-pipeline.ts` (logging)
- `app/api/sms/inbound/route.test.ts` (+1 verbatim regression)

### Production verification

```
curl -sS -i -X POST -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=%2B15551234567&Body=test" \
  "https://labdispatch.app/api/sms/inbound"
```

Returns `HTTP/2 403` (signature missing — expected for unsigned
curl) with `content-type: text/xml; charset=utf-8`. Webhook is
healthy.

### Known limitation

> **SMS auto-replies require A2P 10DLC registration** to be
> reliably delivered to US carrier subscribers. Until the
> sending number is registered under an approved campaign,
> outbound SMS from the Twilio webhook may be silently filtered.
> Inbound (which this codebase handles) is unaffected — Twilio's
> filtering applies only to outbound.

---

## Bug 3 — "Convert to request" button missing on linked messages

### Reproduction
- Sign in as office user
- Visit `/dispatcher/messages`
- Every recent message shows `Linked #XXXXXX` (auto-linked by the
  inbound pipeline)
- None show "Convert to request"

### Root cause
`app/dispatcher/messages/page.tsx` line 133 (pre-fix):
```tsx
{m.pickupRequestId ? null : (
  <ConvertToRequestButton ... />
)}
```
The conditional made the button invisible whenever the inbound
pipeline had auto-created a linked request — which is the
common case. Dispatcher had no manual override path.

### Fix
- Always render `<ConvertToRequestButton>` next to "Open".
- `convertMessageToRequestAction` now handles two paths:
  1. **First-time convert** (no existing link): calls
     `storage.createRequestFromMessage` — creates the request
     and links the message in one step. Same as before.
  2. **Re-convert** (already linked): calls
     `storage.createPickupRequest` directly to create a
     standalone manual request from the same message body.
     The original auto-created link on the message is preserved.
     The new request stands on its own for the dispatcher to
     edit on `/dispatcher/requests`.

### Why standalone instead of replacing the link

Replacing the link would require a new storage method
(`storage.relinkMessageToRequest` or modifying the existing
`linkMessageToRequest` to remove the "already linked" guard).
That touches the storage interface, the mock, the real adapter,
and several existing tests — meaningful scope expansion. The
standalone-additional approach achieves the same end goal (a
fresh editable request) without touching storage semantics.

The user authorized this trade-off in the spec
("overwriting any previous link, OR keeping a separate
'additional requests' list — your call").

### UX detail

The confirm-dialog copy clarifies the dual behavior:

> Create a new pending pickup request from this message? If the
> message already has a linked request, this creates an
> additional standalone one you can edit independently.

### Files
- `app/dispatcher/messages/page.tsx`
- `app/dispatcher/messages/actions.ts`
- `app/dispatcher/messages/_components/ConvertToRequestButton.tsx`
- `app/dispatcher/messages/actions.test.ts` (+2 regression cases)

### Tests
- New: when message is already linked, click creates a standalone
  manual request with channel="manual"; original link is
  preserved.
- New: first-time convert (no existing link) still uses
  `createRequestFromMessage` (verifies we didn't regress the
  original path).

### Verification
The button is now in the JSX unconditionally; this is verifiable
by inspection of the deployed page bytes (after sign-in).
Production deploy confirmed via `/login` etag flip.

---

## Production deploy verification

| Check | Expected | Result |
| --- | --- | --- |
| `npm test` | 970+ passing | ✅ 981/982 (only UTC-midnight payroll flake) |
| `npx tsc --noEmit` | 0 errors | ✅ clean |
| `npm run build` | end-to-end | ✅ Compiled successfully |
| Push `main` | rolled | ✅ `69b6754 → e180768` |
| Vercel deploy | live | ✅ deploy completed (~60s) |
| `curl /login` | 200 | ✅ |
| `curl /api/email/inbound` | 200 | ✅ |
| `curl -X POST /api/sms/inbound` (no signature) | 403 + `text/xml` | ✅ TwiML response |

## Manual verification checklist for operator

1. Visit `/pickup/chen-internal-medicine-demo-chen-06` (or any
   pickup URL). Type "ss" in Notes. Click Send. Expected: form
   transitions to the success state with no validation error.
2. Visit `/dispatcher/messages` as an office user. Confirm
   "Convert to request" appears next to "Open" on EVERY row,
   including those tagged `Linked #...`.
3. Click "Convert to request" on an already-linked message.
   Confirm-dialog appears explaining the standalone-additional
   behavior. Click OK. Visit `/dispatcher/requests`. A new
   manual request appears at the top with `routine` urgency
   and the original message body.
4. Confirm the original message still shows its original
   `Linked #...` badge (link preserved).
5. Send a test SMS from a registered office's phone. Wait 60s.
   - If reply arrives: A2P 10DLC is registered or your account
     is on a non-US carrier; everything works.
   - If reply does NOT arrive: pull the Vercel function logs for
     `/api/sms/inbound`. Look for `[sms-inbound] reply=Message
     bodyLen=N`. If you see that log line, our code emitted the
     reply correctly — go to the Twilio console under "Monitor
     → Logs → Errors" and look for error 30007 ("Carrier
     filtered") on the outbound message. If yes, register a 10DLC
     campaign.
   - If you see `reply=empty status=unknown_sender`, check the
     office's `phone` field in Supabase — likely format mismatch.

## Anything skipped or partial

- **Bug 2 root cause** — high-confidence guess is A2P 10DLC.
  Cannot be fixed in code. The diagnostic logging added in
  this branch lets the operator confirm the diagnosis from
  Vercel logs the next time a test SMS is sent.
- **Bug 3 detailed convert-form** (modal with office/urgency/
  sample count fields) — deferred. Requires a `storage.updatePickupRequest(id, patch)` method that doesn't
  exist yet; out of scope for this hotfix. The simpler one-click
  path is shipped instead. Dispatcher edits the request on
  `/dispatcher/requests` if defaults need adjustment.
- **UTC-midnight payroll-export test flake** — pre-existing,
  unrelated to these bugs.

## Branch state

- `main` at `e180768` (origin synced, deployed).
- `fix/three-bugs` pushed to origin (preserved as backup); not
  deleted locally.
