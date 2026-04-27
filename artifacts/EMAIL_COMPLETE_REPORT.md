# Email feature — completion report

Branch: `feat/email-complete` off `main` @ `0e7bb0f`.

## Phase commits (per-phase, in order)

| Phase | Commit | Headline |
| --- | --- | --- |
| Phase 2 — Real Postmark adapter | `926c894` | `feat(email): real Postmark adapter + widened EmailSendParams` |
| Phase 3 — 5 outbound triggers | `849383a` | `feat(email): wire 5 outbound triggers (3a-3e)` |
| Phase 4 — Inbound webhook auth | `af35492` | `feat(email): inbound webhook auth + parser-driven payload normalization` |
| Phase 5 — Messages UI | `859470c` | `feat(messages): /dispatcher/messages/[id] detail + email/SMS reply` |

(Hashes copied from `git log --oneline`. Re-run that command to see
current state — the values above are point-in-time.)

## Test counts before / after

| Phase | Total | Δ |
| --- | --- | --- |
| Baseline (`main` @ `0e7bb0f`)         | 817 | — |
| After Phase 2 (adapter + widening)    | 839 | +22 |
| After Phase 3 (5 outbound triggers)   | 865 | +26 |
| After Phase 4 (inbound auth)          | 869 | +4  |
| After Phase 5 (messages UI)           | 875 | +6  |

**Total new tests this branch: +58.** Target was +40-60. Final
result is 875/876 passing — see "Known issue" below.

`npx tsc --noEmit`: clean.

## Files added / modified by category

### Adapter + types

- `interfaces/email.ts` — replaced `NotConfiguredError` stub with real
  Postmark adapter; widened `EmailSendParams` from `{ to, subject,
  body }` to `{ to, subject, textBody, htmlBody?, fromName?,
  replyTo? }`; renamed `EmailSendResult.id` → `messageId`. New
  exports: `formatFrom`, `parseInboundWebhook`, `verifyInboundSignature`,
  `ParsedInboundEmail`.
- `interfaces/email.test.ts` — new (+21 tests covering adapter,
  parser, verifier, formatFrom).
- `interfaces/index.ts` — re-exports updated (`InboundEmailPayload` →
  `ParsedInboundEmail`).
- `mocks/email.ts` — match new param/result shape.
- `mocks/email.test.ts` — updated to new shape; +1 test for
  htmlBody/fromName/replyTo retention.

### Email templates

- `lib/email-templates.ts` — new. 5 builders (`buildInviteEmail`,
  `buildWelcomeEmail`, `buildPickupConfirmation`, `buildDriverArrived`,
  `buildSamplesPickedUp`) returning `{ subject, textBody, htmlBody }`.
  Each renders both plain text and a minimal inline-styled HTML
  shell. Every interpolated value goes through `escapeHtml`.
  Includes `appBaseUrl()` (reads `NEXT_PUBLIC_APP_URL`, falls back to
  `https://labdispatch.app`).
- `lib/email-templates.test.ts` — new (+16 tests).

### Outbound triggers (Phase 3)

| Trigger | File | Strategy |
| --- | --- | --- |
| 3a invite created | `app/admin/users/actions.ts` | Send invite email after `createInviteRow`; failure swallowed (modal still surfaces accept URL). |
| 3b invite accepted | `app/invite/[token]/actions.ts` | Send welcome email between `setSession` and `redirect`; failure swallowed. |
| 3c web-form pickup | `app/pickup/[slugToken]/actions.ts` | Replaced ad-hoc body with `buildPickupConfirmation` template. |
| 3c inbound-email pickup | `lib/inbound-pipeline.ts` | Left as-is — preserves `Re:` email-conversation threading; existing copy is already informative. |
| 3d driver arrived | `app/driver/route/actions.ts` (`arriveAtStopAction`) | New: office lookup + email. Failure swallowed. |
| 3e samples picked up | `app/driver/route/actions.ts` (`pickupStopAction`) | Parallel to existing SMS path; independent try/catch so neither blocks the other. |

Tests added per trigger:
- 3a: 2 (`actions.test.ts` — invite-email shape, send-failure isolated)
- 3b: 2 (welcome-email shape, redirect succeeds even when email throws)
- 3c: 1 (htmlBody assertion in pickup actions test)
- 3d: 3 (arrival email shape, no-email skip, swallow-on-failure)
- 3e: 3 (parallel email + SMS, email-only when no phone, email failure doesn't block SMS)

### Inbound webhook (Phase 4)

- `app/api/email/inbound/route.ts` — adopts `verifyInboundSignature`
  for fail-closed 401 short-circuit; uses `parseInboundWebhook` for
  payload normalization (prefers `FromFull.Email`, falls back to
  bare-email extraction).
- `app/api/email/inbound/route.test.ts` — every existing test now
  passes a valid `?token=`; +4 new auth tests (missing token, wrong
  token, env unset → fail-closed, FromFull preference).

### Messages UI (Phase 5)

- `app/dispatcher/messages/[id]/page.tsx` — new. Server-side reads
  `listMessages()` and finds the row by id (`notFound()` when
  missing). For email channel, looks up matching office via
  `findOfficeByEmail`. Renders sender, subject, full body (in `<pre>`
  to preserve whitespace), linked pickup link, and the reply form.
- `app/dispatcher/messages/_components/ReplyForm.tsx` — new client
  form using `useFormState` + `useFormStatus`. Conditional subject
  field (email-only). Inline field errors and a success banner.
- `app/dispatcher/messages/actions.ts` — added `sendReplyAction`,
  `INITIAL_REPLY_MESSAGE_STATE`, `ReplyChannel`. Action **surfaces**
  failures (unlike best-effort outbound triggers) because the
  dispatcher explicitly chose to send. Audit-logs the outgoing reply
  via `storage.createMessage` in a swallowing inner try.
- `app/dispatcher/messages/page.tsx` — list rows now link to detail
  view + "Open" action.
- `app/dispatcher/messages/actions.test.ts` — +7 reply-action tests.

### Documentation

- `artifacts/EMAIL_AUDIT.md` — new (this branch's audit).
- `artifacts/EMAIL_COMPLETE_REPORT.md` — this file.

## Manual verification checklist

Run these against a deployed (or `vercel dev`) instance after the
branch is up. Each step has an expected observable result.

1. **Outbound: admin sends an invite.**
   - Sign in as admin → `/admin/users` → invite a real email
     address as `office`.
   - Expected: invite appears in the list. Within ~10 s the invitee
     receives an email with subject "You've been invited to Lab
     Dispatch", containing a `https://labdispatch.app/invite/{token}`
     link.

2. **Outbound: invitee accepts.**
   - Click the invite link → `/invite/{token}` → click "Accept".
   - Expected: redirected to `/dispatcher` (for office role) or
     `/driver` (for driver role); a "Welcome to Lab Dispatch" email
     arrives at the same address.

3. **Outbound: web-form pickup.**
   - Open an office's pickup URL → submit a request.
   - Expected: the office's email receives a
     "Pickup request received — Lab Dispatch" email with the office
     name, ETA, sample count, and notes in the body.

4. **Outbound: driver arrival + pickup.**
   - As a driver, mark a stop arrived, then picked up.
   - Expected: the office (if its `email` column is set) receives
     two emails — `Driver has arrived at {Name}` then
     `Samples picked up from {Name}`.

5. **Inbound: Postmark sends a test email to the webhook.**
   - In the Postmark dashboard, send a test inbound payload to:
     `https://labdispatch.app/api/email/inbound?token=labdispatch_inbound_secret_2026`
   - Expected: 200 OK with `{"status":"received"|"flagged"|"unknown_sender"}`,
     a row appears under `/dispatcher/messages`. Test without the
     `?token=` query — expected: 401 with
     `{"status":"invalid_signature"}`.

6. **Reply UI.**
   - Open `/dispatcher/messages/{id}` for an email-channel message
     where the sender matches a known office.
   - Expected: "Reply via Email" form appears with `Re: {subject}`
     pre-filled. Submitting sends a real email and shows an
     in-form success banner. The outgoing reply is audit-logged in
     the `messages` table (visible on a refresh of the list view).

## Postmark webhook URL the user must verify in the Postmark console

```
https://labdispatch.app/api/email/inbound?token=labdispatch_inbound_secret_2026
```

- Method: `POST`
- The `?token=` query parameter is required. Without it the route
  returns 401 and Postmark will mark deliveries as failed.
- If you rotate `POSTMARK_INBOUND_WEBHOOK_TOKEN`, also update the
  webhook URL in the Postmark inbound-stream settings — they must
  stay in sync.

## Postmark Test Mode caveat

Postmark accounts are in **Test Mode** until they're approved for
production sending. While in Test Mode, outbound emails are only
delivered to addresses that you've added to the **Verified Sender
Signatures** or that share the same domain as your verified
signature. Trying to send to other addresses returns HTTP 422 with
`ErrorCode: 412` ("Account is pending approval"). The adapter
surfaces these as a thrown `Error` in the action's catch block; the
business action proceeds anyway (failures are swallowed in all
outbound triggers).

To send to arbitrary addresses, complete Postmark's approval
process: provide a sending-volume estimate, sign the anti-spam
policy, and verify the `labdispatch.app` domain via DNS.

## Vercel deploy note

The same three Postmark env vars must be added to the Vercel
project (Production + Preview + Development environments) before
deploy:

```
POSTMARK_SERVER_TOKEN=76da7092-785d-4957-9c3d-fe4266800fe8
POSTMARK_FROM_EMAIL=noreply@labdispatch.app
POSTMARK_INBOUND_WEBHOOK_TOKEN=labdispatch_inbound_secret_2026
```

Optional: `NEXT_PUBLIC_APP_URL=https://labdispatch.app` (the
templates fall back to this exact URL if the var is unset, but
setting it explicitly makes preview deploys produce links to the
preview origin instead).

## Known issue

`app/admin/payroll/export/route.test.ts` has a UTC-midnight flake
that fails when the test run crosses 00:00 UTC (the test seeds
`routeDate: "2026-04-26"` but the CSV's `Start`/`End` columns come
from real `Date.now()` timestamps in `markStopArrived` /
`markStopPickedUp`, which produce a different date after rollover).

This is **pre-existing on `main`** — confirmed by stashing the
Phase-5 changes and re-running the same test against the prior
commit. A separate task has been spawned to fix it (pin time with
`vi.useFakeTimers().setSystemTime(...)` or assert structural shape
instead of a hard-coded date).

875/876 currently passing. The one failure is this flake; expected
to be 876/876 once the time-pinning fix lands or if the suite is
re-run before the next UTC midnight rollover.

## Out of scope (intentional)

- **Postmark approval / domain DNS verification** — operator action;
  see "Postmark Test Mode caveat" above.
- **Inbound-email reply enrichment with htmlBody.** The
  `lib/inbound-pipeline.ts` reply paths still send plain-text only;
  `Re:` threading preserved, copy is informative. A follow-up could
  add the `buildInboundReply` template, but it would mostly duplicate
  `buildPickupConfirmation`.
- **Per-row `getMessage(id)` storage method.** The detail page reads
  via `listMessages()` + find. Fine for the inbox volume; can be
  optimized later if it shows up in profiling.

## Next steps for the operator

1. Verify the three Postmark env vars are set in Vercel.
2. Configure the Postmark inbound webhook URL with the `?token=`.
3. Run the manual verification checklist (above).
4. Submit the Postmark account for approval if not already done.
5. Address the spawned UTC-midnight flake task at convenience.
