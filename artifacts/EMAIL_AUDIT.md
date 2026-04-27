# Email feature audit (Phase 1, take 2)

Branch: `feat/email-complete` off `main` @ `0e7bb0f`.
Baseline test count: **817** (post-merge of all 4 phases + migration).
Type-check: clean.

The previous audit (pre-merge) flagged Phase 3a/3b as deferred because
the invite-flow files lived on a separate branch. **That deferral no
longer applies** — every trigger point in the spec is reachable on
this branch.

## Trigger reachability check

| Phase | Trigger | File | Status |
| --- | --- | --- | --- |
| 3a | Invite created (admin) | `app/admin/users/actions.ts` | ✅ on main |
| 3b | Invite accepted | `app/invite/[token]/actions.ts` | ✅ on main |
| 3c | Web-form pickup confirmation | `app/pickup/[slugToken]/actions.ts:124` | ✅ on main (already calls `services.email.sendEmail`) |
| 3c | Inbound-email pickup confirmation | `lib/inbound-pipeline.ts:80, 118` | ✅ on main (already calls `email.sendEmail`) |
| 3d | Driver arrived | `app/driver/route/actions.ts:41` (`arriveAtStopAction`) | ✅ on main (currently no notifications — clean wire-in point) |
| 3e | Samples picked up | `app/driver/route/actions.ts:50` (`pickupStopAction`) | ✅ on main (already sends SMS — email gets a parallel path) |

All five triggers can be wired in this branch without depending on any
unmerged feature work.

## Files inspected

### `interfaces/email.ts` — STUB, unchanged from main pre-merge

```ts
export interface EmailSendParams {
  to: string;
  subject: string;
  body: string;
}
// ...
createRealEmailService() // throws NotConfiguredError on sendEmail
```

The `EmailSendParams` shape is narrower than Phase 2 needs — it has
`{ to, subject, body }`, the spec calls for
`{ to, subject, textBody, htmlBody?, fromName?, replyTo? }`. The
3 production callers all pass plain text bodies, so widening is
mechanical: rename `body` → `textBody`, add the new optional fields,
update the 3 call sites + the mock.

`createRealEmailService()` will be replaced with a real Postmark
adapter that POSTs to `https://api.postmarkapp.com/email`.

### `app/api/email/inbound/route.ts` — STUB (no signature check)

Same as before the merge. Already has the right structural pattern
(rate-limit → `handleInboundMessage` → always-200). Still missing:

- `?token=` query param check against `POSTMARK_INBOUND_WEBHOOK_TOKEN`
  (returns 401 on mismatch).
- The `TODO(blockers:postmark)` comment is the explicit anchor.

### `app/api/sms/inbound/route.ts` — NOW signature-aware on main

Big change since the previous audit: the merged Phase C work brought
real Twilio HMAC-SHA1 signature verification into main:

```ts
const url = reconstructWebhookUrl(req);
const headerSignature = req.headers.get("x-twilio-signature");
const ok = verifyTwilioSignature({ url, params, authToken, headerSignature });
if (!ok) return NextResponse.json({ status: "invalid_signature" }, { status: 403 });
```

This is a **behavioral** mirror, not a structural one — Postmark's
authenticity model is "secret token in the webhook URL", not
"HMAC over the body". Phase 4 will adopt the same fail-closed posture
(401 instead of Twilio's 403, but same idea: refuse unsigned traffic
rather than letting it through).

### `supabase/schema.sql` — `messages` table correctly shaped

Unchanged, still:

```sql
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel public.request_channel not null,
  from_identifier text not null,
  subject text,
  body text not null,
  received_at timestamptz not null default now(),
  pickup_request_id uuid references public.pickup_requests(id) on delete set null
);
```

All 6 spec-required columns present, index on `pickup_request_id` in
place, RLS enabled, `dispatcher`/`admin`/`office` (Phase D widening)
all admitted. **No schema changes required for any of Phases 2-7.**

## Phase 3 outbound trigger anatomy (now wireable end-to-end)

### 3a — Invite email

`app/admin/users/actions.ts:27` is `createInviteAction`:

```ts
export async function createInviteAction(...): Promise<...> {
  // ... validation ...
  return { status: "ok", invite, acceptUrl };
}
```

The invite object has `email`, `role`, `token`. Phase 3a inserts a
single `try { await services.email.sendEmail(...) } catch {}` block
right before the `return { status: "ok", ... }` — failure-isolated,
in-app modal still works as fallback (the `acceptUrl` is still
returned to the UI).

### 3b — Welcome email

`app/invite/[token]/actions.ts:28` is `acceptInviteAction`:

```ts
await setSession(acceptedByProfileId, result.invite!.role);
redirect(landingPathFor(result.invite!.role));
```

Phase 3b inserts the email send **between** `acceptInvite` and
`setSession` (or just before `redirect`) — the welcome email is fire-
and-forget, with role-conditional copy/landing path.

### 3c — Pickup confirmation (web + inbound email)

Two existing call sites on main:

- `app/pickup/[slugToken]/actions.ts:124` — already calls
  `services.email.sendEmail({ to, subject, body })`. Phase 3c just
  enriches the body and adds `htmlBody`.
- `lib/inbound-pipeline.ts:80, 118` — same pattern, two existing
  call sites for unknown-sender and known-office responses.

### 3d — Driver arrived

`app/driver/route/actions.ts:41`:

```ts
export async function arriveAtStopAction(stopId: string): Promise<void> {
  const session = await requireDriverSession();
  await loadActiveStopForDriver(stopId, session);
  await getServices().storage.markStopArrived(stopId);
  revalidatePath(...);
}
```

Currently has **no** notification side effect — clean wire-in point.
Phase 3d will resolve the office (via `pickupRequest.officeId`) and
fire the email, mirroring how `pickupStopAction` already does for SMS.

### 3e — Samples picked up

`app/driver/route/actions.ts:50` (`pickupStopAction`) already does the
SMS path that Phase C wired up. Phase 3e adds a parallel email path
in the same `try` block, using the same office lookup.

## Other findings

- `mocks/email.ts` already has the in-memory `sent[]` array and the
  defensive `if (!params.to) throw` guard. Phase 6 tests can read
  `getSent()` exactly the way SMS tests do.
- `BLOCKERS.md` still lists `[inbound-email]` as a blocker —
  Phase 7 should mark it resolved.
- The `dispatcher/messages` page exists with list view + `flagged`/
  `all` tabs. **No detail route at `/dispatcher/messages/[id]`** — new
  in Phase 5. **No reply form** — also new in Phase 5. The "Messages"
  sidebar link is already wired in `components/DispatcherLayout.tsx`.

## Test target on this branch

- Baseline: **817**.
- Phase 6 target: +40-60 → **857-877**.
- Per-step gates:
  - After Phase 2 (real adapter + widened type): existing 817 must
    still pass after the 3 callers + mock are updated.
  - After Phase 3-4: each new outbound trigger and the inbound 401
    short-circuit gets dedicated tests.
  - After Phase 5: messages detail/reply UI tests.

## Plan for Phase 2+ (informational only)

1. **Phase 2** — replace `interfaces/email.ts` stub with real Postmark
   adapter (HTTP POST to `api.postmarkapp.com/email`, throws on
   non-200, returns `{ messageId }` on 200). Widen `EmailSendParams`
   to `{ to, subject, textBody, htmlBody?, fromName?, replyTo? }`.
   Add `parseInboundWebhook` and `verifyInboundSignature`. Update the
   3 production callers + `mocks/email.ts`.
2. **Phase 3a** — invite email in `app/admin/users/actions.ts`.
3. **Phase 3b** — welcome email in `app/invite/[token]/actions.ts`.
4. **Phase 3c** — enrich pickup confirmations in
   `app/pickup/[slugToken]/actions.ts` and `lib/inbound-pipeline.ts`.
5. **Phase 3d** — driver-arrived email in `arriveAtStopAction`.
6. **Phase 3e** — samples-picked-up email in `pickupStopAction`
   (parallel to existing SMS).
7. **Phase 4** — add `?token=` 401 short-circuit to
   `app/api/email/inbound/route.ts`.
8. **Phase 5** — `app/dispatcher/messages/[id]/page.tsx` detail view
   + reply form server action.
9. **Phase 6** — tests, target 857-877.
10. **Phase 7** — `EMAIL_COMPLETE_REPORT.md`.

## STOP

Awaiting "proceed" before Phase 2.
