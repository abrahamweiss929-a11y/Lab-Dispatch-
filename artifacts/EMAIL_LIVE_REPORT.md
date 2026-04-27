# Email feature — live in production

Date: 2026-04-26 (UTC midnight passed; deployment 2026-04-27 UTC).
Production: `https://labdispatch.app`
Main HEAD: `e48b840` (merge commit of `feat/email-complete` → `main`).

## What's now active in production

### Inbound (Postmark webhook)

- `POST https://labdispatch.app/api/email/inbound?token=labdispatch_inbound_secret_2026`
- Validates the `?token=` query param against
  `POSTMARK_INBOUND_WEBHOOK_TOKEN` (constant-time compare, fails
  closed when env var unset).
- Parses Postmark JSON via `parseInboundWebhook` (prefers
  `FromFull.Email`, falls back to `From` angle-bracket extraction).
- Per-sender rate limit via `emailInboundBucket`.
- Hands off to `handleInboundMessage` — same pipeline SMS uses;
  AI-parses the body, matches sender to office, creates a
  `pickup_request` (status: `pending`/`flagged`/`unknown_sender`),
  inserts a row in `messages`, sends an auto-reply.
- `GET https://labdispatch.app/api/email/inbound` — health probe
  for Postmark's URL validator. Returns
  `{"status":"ok","endpoint":"email-inbound"}` on 200.

### Outbound (Postmark adapter)

- `interfaces/email.ts` is now a real Postmark adapter that POSTs
  to `https://api.postmarkapp.com/email` with
  `X-Postmark-Server-Token`, returns `{ messageId }` on 2xx, throws
  on non-2xx. Reads `POSTMARK_SERVER_TOKEN` and
  `POSTMARK_FROM_EMAIL` from env at call time.
- `EmailSendParams` shape is now
  `{ to, subject, textBody, htmlBody?, fromName?, replyTo? }`.

### The 5 outbound triggers (where each fires)

| # | Trigger | File | Behavior |
| --- | --- | --- | --- |
| 3a | Admin creates an invite | `app/admin/users/actions.ts` (`createInviteAction`) | Sends an invite email with the absolute `/invite/{token}` URL right after `createInviteRow`. Failure swallowed; modal still surfaces the accept URL as a fallback. |
| 3b | Invitee accepts | `app/invite/[token]/actions.ts` (`acceptInviteAction`) | Welcome email fires between `setSession` and `redirect`. Failure swallowed; redirect succeeds either way. |
| 3c | Web-form pickup OR inbound-email pickup | `app/pickup/[slugToken]/actions.ts` and `lib/inbound-pipeline.ts` | Web form uses `buildPickupConfirmation` template with full HTML body. Inbound-email path preserves `Re:` threading with the existing succinct copy. |
| 3d | Driver marks stop arrived | `app/driver/route/actions.ts` (`arriveAtStopAction`) | Looks up office via stop → pickupRequest → office; sends `Driver has arrived at {Name}` if `office.email` is set. |
| 3e | Driver marks stop picked up | `app/driver/route/actions.ts` (`pickupStopAction`) | Parallel email path next to the existing SMS path; independent try/catch so neither blocks the other. Sends `Samples picked up from {Name}` with sample count. |

All 5 are wrapped in `try/catch` with `console.error` on failure —
no business action ever rolls back because email failed.

### Messages UI

- `/dispatcher/messages` — list view with channel icon, sender,
  subject, body preview, linked-pickup badge, "Open" link to the
  detail view.
- `/dispatcher/messages/[id]` — detail view: full body, sender,
  matched-office lookup, linked-pickup link, and a reply form.
- Reply form supports email and SMS. Email replies require the
  sender to match a known office's email (per spec); SMS replies
  available for any SMS-channel message. Failures DO surface in the
  reply form (unlike best-effort outbound triggers) — dispatcher
  needs to know if the reply landed.
- Outgoing replies are audit-logged via `storage.createMessage`.

## Webhook URL Postmark needs to use

```
https://labdispatch.app/api/email/inbound?token=labdispatch_inbound_secret_2026
```

- HTTP POST, JSON payload (Postmark's standard inbound format).
- The `?token=` is mandatory — without it, the route returns 401.
- If you rotate `POSTMARK_INBOUND_WEBHOOK_TOKEN` in Vercel env, you
  must update the webhook URL in Postmark's inbound-stream settings
  in lockstep. They have to match byte-for-byte.

## Verification done after merge

| Check | Result |
| --- | --- |
| `npm test` | 875 / 876 passing (1 pre-existing UTC-midnight flake — see "Leftover TODOs") |
| `npx tsc --noEmit` | 0 errors |
| `npm run build` | Compiled successfully end-to-end |
| `GET /api/email/inbound` (production) | 200 + `{"status":"ok","endpoint":"email-inbound"}` |
| `POST /api/email/inbound` no token (production) | 401 + `{"status":"invalid_signature"}` |
| `POST /api/email/inbound?token=...` (production) | 200 (token check passed; structural validator caught the empty test body) |

## Leftover TODOs

1. **UTC-midnight payroll-export test flake** (pre-existing, not
   caused by email work). The test
   `app/admin/payroll/export/route.test.ts > CSV body includes a
   row per qualifying driver in range` asserts the CSV contains
   `"2026-04-26"` but the dates come from real `Date.now()` in
   `markStopArrived`/`markStopPickedUp`. Fails when the test run
   crosses UTC midnight. A spawn-task was already opened to fix
   this with `vi.useFakeTimers().setSystemTime(...)`.
2. **Postmark approval status** — outbound email is limited to
   verified addresses while the account is in Test Mode. Confirm
   the production approval is complete to enable arbitrary
   recipients.
3. **In-memory `lib/invites-store.ts`** — Phase D's invite store
   is still a `Map<string, Invite>` in process memory. Production
   should swap this for Supabase-backed storage (the SQL columns
   are already shaped to match — see
   `supabase/migrations/2026-04-26-phase-d-invites.sql`). The
   swap is documented at the top of `lib/invites-store.ts`.
4. **`acceptInviteAction` real-mode user provisioning** — in mock
   mode, the action mints a fake `userId` via `makeRandomId()`. In
   production (`USE_MOCKS=false`) it should call
   `supabase.auth.admin.createUser({ email, email_confirm: true })`
   and insert the `profiles` row before `setSession`. Documented
   in `artifacts/PHASE_D_REPORT.md`.
5. **`feat/maps-everywhere` branch** — preserved on origin but not
   merged. Has 4 unique commits worth of map UI that diverges from
   the design refresh on main; needs rebase + conflict resolution
   if you want to land it.
6. **Logout button flicker** — flagged by user as low-priority
   visual bug; no fix applied.

## Branch state

- **Local:** only `main` and `feat/maps-everywhere`. `fix/driver-not-found-regression` may also still be present.
- **Origin:** `main` plus 18 stale `feature/*` branches and the
  preserved phase branches (`feat/email-complete`,
  `feat/google-routing`, `feat/payroll-view`, `feat/sms-production`,
  `feat/invite-flow`, `feat/maps-everywhere`,
  `fix/safe-phase-d-migration`, `test/all-phases-combined`).
- `feat/email-complete` was deleted locally (safe `-d` confirmed
  it was fully merged into `main`); origin copy preserved at
  `c1a8593` as backup.

## Vercel env vars to verify

```
POSTMARK_SERVER_TOKEN=76da7092-785d-4957-9c3d-fe4266800fe8
POSTMARK_FROM_EMAIL=noreply@labdispatch.app
POSTMARK_INBOUND_WEBHOOK_TOKEN=labdispatch_inbound_secret_2026
```

These need to be set in Production + Preview + Development
environments on Vercel. `POSTMARK_SERVER_TOKEN` and
`POSTMARK_FROM_EMAIL` enable the outbound adapter;
`POSTMARK_INBOUND_WEBHOOK_TOKEN` is checked against the `?token=`
on inbound. Optional: `NEXT_PUBLIC_APP_URL` (defaults to
`https://labdispatch.app`).
