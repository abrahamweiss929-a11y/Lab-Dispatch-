# Phase D Report — Invite-based Onboarding

Branch: `feat/invite-flow` (off `main`).

## Goal

Add a single-tenant invite flow so an admin can onboard new users
without sharing a shared password. Three pieces:

1. New `office` user role, equivalent in authority to `dispatcher`
   (same `/dispatcher` tree, same edit permissions). Backward compat
   for existing `dispatcher` accounts is preserved.
2. `/admin/users` page where admins create + revoke invites.
3. Public `/invite/[token]` accept page that lands the user on the
   appropriate role tree.

Plus: Supabase schema updates (enum value, `invites` table, RLS).

## What changed

### New files

- `lib/invites.ts` — pure helpers: `generateInviteToken`
  (32-byte base64url), `defaultInviteExpiryIso` (now + 7 days),
  `evaluateInvite` (returns ok / not_found / expired / revoked /
  already_accepted), `isValidInviteEmail`.
- `lib/invites.test.ts` — 15 tests.
- `lib/invites-store.ts` — in-memory invite store (`createInvite`,
  `getInviteByToken`, `listInvites`, `lookupInviteForAccept`,
  `acceptInvite`, `revokeInvite`, `resetInviteStore`). Tagged
  `"server-only"`. The production swap to Supabase is mechanical —
  documented in the file's header.
- `lib/invites-store.test.ts` — 9 tests.
- `app/admin/users/page.tsx` — admin UI: "Invite a new user" form +
  recent-invites table with revoke action.
- `app/admin/users/actions.ts` — `createInviteAction`,
  `revokeInviteAction`. Validates email + role, gates on
  `requireAdminSession`.
- `app/admin/users/actions.test.ts` — 6 tests.
- `app/admin/users/_components/InviteForm.tsx` — client form using
  `useFormState` + `useFormStatus`.
- `app/invite/[token]/page.tsx` — public accept page; reads token
  via `lookupInviteForAccept`, shows error or "Welcome" + accept
  button.
- `app/invite/[token]/actions.ts` — `acceptInviteAction`. Marks the
  invite accepted, signs the user in via `setSession`, and
  `redirect()`s to the role landing path.
- `app/invite/[token]/actions.test.ts` — 5 tests.
- `app/invite/[token]/_components/AcceptInviteForm.tsx` — client
  form.
- `artifacts/PHASE_D_REPORT.md` — this file.

### Modified files

- `lib/types.ts` — `UserRole` widened to include `"office"`. Added
  `OFFICE_LIKE_ROLES` and the `Invite` interface.
- `lib/auth-rules.ts` — `PROTECTED_TREES.office = "/dispatcher"`,
  `evaluateAccess` treats `office` like `dispatcher`,
  `PUBLIC_PATH_PREFIXES` includes `/invite/`.
- `lib/auth-rules.test.ts` — added 3 tests (office role, /invite/
  is public) and updated 2 expectations.
- `lib/permissions.ts` — `canDispatcherEditRoute` accepts
  `office`.
- `lib/require-dispatcher.ts` — accepts `office` sessions.
- `components/AdminLayout.tsx` — new "Users" sidebar nav link.
- `supabase/schema.sql` — added `office` enum value (idempotent
  `alter type ... add value if not exists`), `invite_status` enum,
  `invites` table + indexes + RLS, and updated all
  `current_role() in ('dispatcher','admin')` predicates to also
  include `'office'`.

## Tests

```
Test Files  61 passed (61)
     Tests  738 passed (738)
```

Phase D added **38** tests on top of the 700-test baseline. `tsc
--noEmit` clean.

## Backward compat

- Existing `dispatcher` profiles work unchanged — the role enum
  still includes `dispatcher` and all RLS policies admit it.
- The `dispatcher@test` mock account in `mocks/seed.ts` continues
  to seed with role `dispatcher`; nothing about its login flow
  changed.
- Existing `requireDispatcherSession` callers gain `office` access
  for free; no caller had to change.

## Out of scope (intentional)

- **Real Supabase user provisioning on accept.** In mock mode
  `acceptInviteAction` mints a fresh `userId` via `makeRandomId()`
  and writes the session cookie directly — enough to demo the
  flow end-to-end. In production (USE_MOCKS=false) the action
  must instead call `supabase.auth.admin.createUser({ email,
  email_confirm: true })`, insert the matching `profiles` row
  with the invited role, and *then* sign the new user in. That
  swap lives behind the same module boundary (`lib/invites-store.ts`
  + `app/invite/[token]/actions.ts`) and is documented inline.
- **Sending the invite email.** The flow currently surfaces the
  accept URL in the admin UI for the admin to copy/paste. Sending
  the email through `services.email.sendEmail` is a one-liner once
  Phase D is in production — left out of Phase D's scope so this
  branch doesn't depend on Phase C's branch.
- **Widening `/admin/payroll` to `office` role.** The payroll page
  lives on `feat/payroll-view` (Phase B) and is not on this
  branch. When the two branches eventually merge, swap
  `requireAdminSession` for a helper that also admits `office`
  in `app/admin/payroll/page.tsx` and `app/admin/payroll/export/route.ts`.
- **Existing `/dispatcher/*` page-level role checks.**
  `requireDispatcherSession` and `evaluateAccess` already admit
  `office`; per-page guards inherit that automatically.

## Manual setup required before going live

1. Apply `supabase/schema.sql` to the production project — the file
   is idempotent and adds:
   - The `office` enum value on `user_role`.
   - The `invite_status` enum.
   - The `invites` table + indexes.
   - Invite RLS policies.
   - Updated dispatcher-or-admin policies that now also admit
     `office`.
2. Replace the in-memory `lib/invites-store.ts` with
   storage-service methods for production. The interface is
   already shaped to match the SQL columns.
3. After accepting an invite, the action must hand off to
   Supabase Auth (`supabase.auth.admin.createUser`) before
   calling `setSession`. See "Out of scope" above.

## Commit

Single commit on this branch — see `feat(invites): admin invite
flow + office role`.
