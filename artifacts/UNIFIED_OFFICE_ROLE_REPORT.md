# Unified office role — implementation report

Branch: `feat/unify-office-role` off `main` @ `8967128`.

## What changed

The back-office app now presents a single unified role — `office` —
that combines what `admin` and `dispatcher` were before. Two roles
total: `office` (back-office staff) and `driver` (mobile drivers).

### Phase commits

| Phase | Commit | Description |
| --- | --- | --- |
| 1 — Migration SQL | `e1f659e` | `feat(supabase): migration to unify admin+dispatcher into 'office' role` |
| 2 — Code refactor | `d52e473` | `feat(roles): unify admin+dispatcher into 'office' (auth, sidebar, mocks)` |
| 3 — Tests          | `aaffc0a` | `test(roles): acceptance tests for unified office role` |

### Files by category

#### Schema migration (Phase 1)
- `supabase/migrations/2026-04-27-unify-office-role.sql` — new file.
  385 lines. Updates existing rows, drops 37 legacy policies (22
  admin-only + 15 dispatcher-admin-office combined), creates 30
  unified office-only policies. Replaces `current_role()` in place
  via `create or replace function` to preserve dependent-policy oid
  bindings. Idempotent.

#### Auth + routing (Phase 2)
- `lib/auth-rules.ts` — new `OFFICE_ROLES` set and `isOfficeRole()`
  helper. `PROTECTED_TREES` maps every back-office role to
  `/dispatcher`. `evaluateAccess` allows any office role across BOTH
  `/admin/*` and `/dispatcher/*` trees.
- `lib/require-admin.ts` — gate now delegates to `isOfficeRole`.
- `lib/require-dispatcher.ts` — same.
- `lib/permissions.ts` — `canDispatcherEditRoute` uses `isOfficeRole`.

#### UI (Phase 2)
- `components/AdminLayout.tsx` and `components/DispatcherLayout.tsx`
  — both layouts now show the identical 10-item sidebar
  (Dashboard → Requests → Routes → Map → Messages → Drivers →
  Doctors → Offices → Payroll → Users). Brand subtitle is "Office"
  in both.

#### Mocks + scripts (Phase 2)
- `mocks/auth.ts` — `admin@test` and `dispatcher@test` now seed
  with `role: 'office'`. Legacy emails preserved for muscle memory.
- `scripts/seed-live-accounts.ts` — same change for the
  `npm run seed-live-accounts` script.

#### Invite flow (Phase 2)
- `lib/email-templates.ts` — invite email subject is now role-specific:
  `"You've been invited to Lab Dispatch as office staff"` /
  `"... as a driver"`.

#### Tests (Phase 2 update + Phase 3 new)
- `lib/auth-rules.test.ts` — rewrote PROTECTED_TREES, landingPathFor,
  and per-role evaluateAccess tests for unified behavior.
- `lib/require-admin.test.ts` — now asserts office/admin/dispatcher
  all granted; only driver/null denied.
- `mocks/auth.test.ts` — legacy logins resolve to `office`.
- `app/login/actions.test.ts` — admin login now redirects to
  `/dispatcher` (the unified landing).
- `app/admin/payroll/export/route.test.ts` — denies driver only;
  added a test that dispatcher and office are both granted.
- `app/admin/users/actions.test.ts` — invite subject assertion
  updated.
- `lib/email-templates.test.ts` — invite subject assertions
  updated.
- `lib/unified-office-role.test.ts` — **new file**, 37 acceptance
  tests covering all the user-facing scenarios in the spec.
- `app/admin/users/_components/InviteForm.test.tsx` — **new file**,
  asserts the role select offers exactly "Office staff" and
  "Driver".

## SQL the user must run in Supabase

The migration file is at:

```
supabase/migrations/2026-04-27-unify-office-role.sql
```

Apply it to the production database via the Supabase SQL Editor.
The whole file is one batch (no PART 1 / PART 2 split this time —
no enum value additions, no commit-between requirements).

After running, confirm with the verification queries that are
commented out at the bottom of the file. Quick checks:

```sql
-- 1. No back-office user is left on a legacy role:
select role, count(*) from public.profiles group by role;
-- Expect: 'office' and 'driver' rows. 'admin' and 'dispatcher' rows
-- count = 0.

-- 2. No surviving policy references 'admin' or 'dispatcher':
select schemaname, tablename, policyname, qual::text as predicate
  from pg_policies
 where schemaname = 'public'
   and (qual::text like '%''admin''%' or qual::text like '%''dispatcher''%');
-- Expect: 0 rows.

-- 3. Office-gated policies are in place:
select count(*) from pg_policies
  where schemaname = 'public' and qual::text like '%''office''%';
-- Expect: 30+.
```

## Manual verification checklist

After applying the SQL migration, work through these on a deployed
preview (or `vercel dev` against the production DB):

1. **Apply the migration.** Paste
   `supabase/migrations/2026-04-27-unify-office-role.sql` into the
   Supabase SQL Editor and run it. Watch for errors. Run the three
   verification queries above to confirm the migrated state.

2. **Restart / redeploy the Next.js app.** The session cache /
   profile cache needs to pick up the new roles. Vercel auto-deploy
   on push covers this; for `vercel dev`, restart the server.

3. **Sign in as a legacy account.** `admin@test` / `test1234` should
   succeed and land at `/dispatcher` (the unified dashboard). Same
   for `dispatcher@test` / `test1234`. Both sessions should resolve
   to role `office`.

4. **Confirm the unified sidebar.** Once signed in, the sidebar
   should show all 10 links in this order: Dashboard, Requests,
   Routes, Map, Messages, Drivers, Doctors, Offices, Payroll,
   Users. Click each one — each should land on the corresponding
   page without a redirect.

5. **Confirm cross-tree access.** Visit `/admin/drivers` directly,
   then `/dispatcher/requests` directly. Both should render. There
   is no longer any sub-gating between admin-only and
   dispatcher-only pages.

6. **Driver still constrained.** Sign in as `driver@test` /
   `test1234`. Land at `/driver`. Try to navigate manually to
   `/admin`, `/dispatcher`, or any sub-page — each should redirect
   back to `/driver`.

7. **Invite flow.** As an office user, visit `/admin/users`. The
   role dropdown should offer only "Office staff" and "Driver".
   Send an invite to a real email — the subject should read
   "You've been invited to Lab Dispatch as office staff" (or "as a
   driver" for driver invites).

8. **RLS sanity check.** As an office user, view `/admin/drivers`
   (lists drivers via Supabase RLS). The list should populate. As
   a driver, the same page should redirect away.

9. **Audit a non-trivial action.** As an office user, create a
   pickup route, add stops, mark them. Everything that worked
   before unification should still work — there are no
   sub-gates, just a single office role.

10. **Sign out + re-sign in.** Confirm the session cookie correctly
    surfaces the post-migration role.

## Backward-compat notes

The migration is one-way (back-office rows move to `office`), but
the **code** is intentionally tolerant of any profile row still
sitting on the legacy `admin` or `dispatcher` value:

- `isOfficeRole()` admits all three values.
- `requireAdminSession()` and `requireDispatcherSession()` both gate
  on `isOfficeRole()`, so a not-yet-migrated row still authenticates
  and sees the same UI.
- `evaluateAccess` treats all three identically.
- `landingPathFor()` returns `/dispatcher` for all three.

This means: applying the migration is decoupled from the code
deploy. You can deploy the code first (Vercel-side); existing rows
with role `admin` keep working. Then apply the SQL migration when
convenient — no users will be locked out during the transition.

After the migration is applied AND the code is deployed, only
`office` and `driver` will exist in production data, even though
`admin` and `dispatcher` remain valid enum values that Postgres
won't let us drop without a full type rebuild.

## What's intentionally NOT in this branch

- **The Phase D `/admin/payroll → office` follow-up** is now
  resolved by this work. Payroll is in the unified sidebar and
  every office user can reach it.
- **`supabase/schema.sql` changes.** That file describes a "fresh
  project" install. It still contains the original 22 admin-only +
  15 dispatcher-admin-office policies, plus the Phase D widening
  comment. After this migration lands AND the user wants future
  fresh installs to come up unified out-of-the-box, schema.sql
  should be updated separately.
- **Removing `admin` and `dispatcher` from the `user_role` enum.**
  Postgres can't drop enum values without a full type rebuild
  (rewrite every dependent column with a CASE expression, drop the
  type, recreate it). Not worth the operational risk for two
  unused enum tags.
- **Email feature, SMS feature, maps branch.** Per spec — not
  touched.
- **Bug fixes (invite link absolute URL, pickup URL, etc.) you
  flagged in earlier turns.** Per spec, those are tracked
  separately and not landed on this branch.

## What I noticed but did not fix

While walking the codebase for this refactor, I noticed these but
left them alone (per spec — bug fixes belong on a separate task):

1. **`app/admin/page.tsx` and `app/dispatcher/page.tsx` are
   different "dashboards"**. After this unification, `landingPathFor`
   sends every office user to `/dispatcher`, so `/admin` is no
   longer anyone's home. It still renders if a user types it in.
   A future cleanup could either render the same content for both
   URLs (true alias) or redirect `/admin` → `/dispatcher`.

2. **The UTC-midnight `payroll-export` test flake** is still
   present (`app/admin/payroll/export/route.test.ts > CSV body
   includes a row per qualifying driver in range`). Pre-existing,
   already tracked in a separate spawn-task earlier.

## Branch state

- Local: `main`, `feat/unify-office-role` (this branch),
  `feat/maps-everywhere` (still preserved).
- Remote: pushed to `origin/feat/unify-office-role` (after
  Phase 5 push).

## What's next (operator action items)

1. **Review this branch.** All changes are on
   `feat/unify-office-role`. Cherry-pick or merge to main when ready.

2. **Apply the migration manually** (see "SQL the user must run"
   above). The migration is decoupled from the code deploy — order
   doesn't matter for correctness, but applying SQL after the code
   is deployed gives the cleanest experience (no
   "logged-in-as-admin-but-now-resolves-to-office" mid-session
   surprises).

3. **Run the manual verification checklist** above against the
   migrated production database.

4. **Decide on the `/admin` vs `/dispatcher` URL question.** Right
   now both work as aliases. If you want a true alias (same content),
   convert `/admin/page.tsx` to render the dispatcher dashboard or
   redirect to it.
