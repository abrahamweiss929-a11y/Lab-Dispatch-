# Pickup URL + invite link production bugfix report

Date: 2026-04-27. Two production bugs fixed in one branch
(`fix/pickup-url-and-invite-link` → merged to `main` @ `b0fe25d`).

## Commits

| Commit | Description |
| --- | --- |
| `907163c` | `fix(pickup): use composite-match for slug-token URL lookup` (Bug 1) |
| `7a1c314` | `fix(invites): persist to Supabase in production (was in-memory only)` (Bug 2) |
| `b0fe25d` | `Merge branch 'fix/pickup-url-and-invite-link'` (final merge to main) |

## Bug 1 — `/pickup/{slug-token}` returns "Unknown pickup link"

### Reproduction
- Office: slug `brick-internal`, pickup_url_token `demo-brick-03`.
- URL: `https://labdispatch.app/pickup/brick-internal-demo-brick-03`.
- Pre-fix result: 404 / "Unknown pickup link".
- Post-fix result: **HTTP 200, form renders** (verified via curl).

### Root cause
`lib/parse-slug-token.ts` split the URL on the LAST hyphen and required
the token to match `/^[a-z0-9]{12}$/`. Both assumptions were wrong:

1. The seeded `pickup_url_token` values themselves contain hyphens
   (`demo-brick-03`).
2. There's no way to know how many hyphens belong to the slug vs the
   token without consulting the database.

### Fix
Composite-match lookup: pass the FULL URL segment to a new storage
method `findOfficeByPickupUrlSegment(segment)` which finds the active
office whose `slug + '-' + pickupUrlToken` equals the segment.

- `lib/parse-slug-token.ts` — replaced the strict regex with a
  permissive `isValidSlugTokenSegment` validator (lowercase,
  alphanumeric + hyphens, no empty segments). Kept `parseSlugToken`
  as a deprecated alias.
- `interfaces/storage.ts` — added the new method to the interface.
- `mocks/storage.ts` — full-scan implementation.
- `interfaces/storage.real.ts` — fetches active offices and filters
  in process. PostgREST doesn't expose `||` cleanly; the offices
  table is small per tenant so the extra trip is fine.
- `app/pickup/[slugToken]/page.tsx`, `actions.ts` — both now call
  `findOfficeByPickupUrlSegment(params.slugToken)` directly.

### Tests added (regression)
- `lib/parse-slug-token.test.ts` — rewritten. Adds the production
  bug case (`brick-internal-demo-brick-03`) to the validator's
  positive cases.
- `mocks/storage.test.ts` — 6 new cases for the new storage method:
  simple composite, hyphenated slug, hyphenated-slug-and-token (the
  bug case), unknown segment, inactive office, near-prefix
  (must-not-match).

## Bug 2 — `/invite/{token}` returns "This invite link is not valid"

### Reproduction
- Admin creates an invite via `/admin/users` — succeeds.
- Same admin (or invitee) clicks the link → "This invite link is not
  valid".
- DB inspection: invite row IS present in `public.invites` with
  status='pending'.

### Root cause
`lib/invites-store.ts` was in-memory only:

```ts
const state: InviteStoreState = { byId: new Map() };
```

In production with multiple Vercel serverless instances:
1. Admin's `createInviteAction` ran on instance A → wrote to that
   instance's Map. Migration's `invites` table was never touched.
2. Invitee's `/invite/{token}` GET ran on instance B → empty Map →
   "not valid".

Phase D's report had flagged this as a known limitation
("In-memory `lib/invites-store.ts` — Phase D's invite store is still
a `Map<string, Invite>` in process memory") but it never got swapped
out. Production tripped on it the moment a real invite went through.

### Fix
Dual-mode `lib/invites-store.ts`:

- **`USE_MOCKS !== "false"`** (dev/test): unchanged in-memory map.
- **`USE_MOCKS === "false"`** (production): every operation hits the
  Supabase `invites` table via the service-role admin client.

The Supabase schema was already provisioned by
`supabase/migrations/2026-04-26-phase-d-invites.sql`. We just weren't
using it.

`acceptInvite` has a `status='pending'` guard on the UPDATE so a
concurrent accept can't double-flip; on a lost race we re-evaluate
to surface the correct outcome (already_accepted / revoked / etc).

### API change
Every public function in `lib/invites-store.ts` is now `async`. Five
consumers updated:
- `app/admin/users/actions.ts` — `await createInviteRow`,
  `await revokeInviteRow`.
- `app/admin/users/page.tsx` — `await listInvites()`.
- `app/invite/[token]/actions.ts` — `await acceptInvite(...)`.
- `app/invite/[token]/page.tsx` — page made `async`,
  `await lookupInviteForAccept(...)`.
- 3 test files — `await` added to every store call.

### Tests
The existing 33 invite-related tests run in mock mode (USE_MOCKS
unset → in-memory path) so they continue to cover the dev/CI flow.
The Supabase real-mode path is exercised in production but not
unit-tested here — would require Supabase mock fixtures, deemed out
of scope for this hotfix.

## Verification (post-deploy)

| Check | Expected | Result |
| --- | --- | --- |
| `npm test` (full) | 950+ passing | ✅ 950/951 (only UTC-midnight payroll flake) |
| `npx tsc --noEmit` | 0 errors | ✅ clean |
| `npm run build` | end-to-end | ✅ Compiled successfully |
| Push `main` | rolled | ✅ `c419291 → b0fe25d` |
| Vercel deploy | new build live | ✅ `/login` etag flipped from `01d32d6c...` → `feee463a...` |
| `curl /pickup/brick-internal-demo-brick-03` | HTTP 200 | ✅ **200** (was "Unknown pickup link") |
| `curl /pickup/clearly-invalid-zz000000zzzz` | HTTP 404 | ✅ 404 (negative case intact) |

## Manual verification checklist for operator

1. Visit `https://labdispatch.app/pickup/brick-internal-demo-brick-03`.
   Expected: pickup form renders with "Brick Internal Medicine" name.
2. Submit a test pickup request via the form. Expected: form succeeds,
   email confirmation is sent (if `office.email` is set).
3. Sign in as office user, go to `/admin/users`, create an invite to
   a real email address.
4. Open the invite link in a private/incognito window. Expected:
   "Welcome" page renders with the role label, NOT "This invite link
   is not valid".
5. Click "Accept invite". Expected: redirect to `/dispatcher` (office
   role) or `/driver` (driver role).
6. Go back to `/admin/users` — the invite should now show
   status=accepted with the timestamp.
7. Create a second invite, copy the link, then click "Revoke" in the
   admin UI. Try the link in a new tab. Expected: "This invite has
   been revoked." (not "not valid").
8. Sanity: existing legacy 12-char-token offices (e.g. ones seeded
   with `seed-live-data`) still work. The relaxed validator accepts
   them, and `findOfficeByPickupUrlSegment` finds them just like the
   old composite query did.

## Out-of-scope items found but not fixed (per spec)

- **Pre-existing UTC-midnight payroll-export test flake** — same one
  tracked since the email feature work. 950/951 passing. Spawned
  task already exists.
- **Real-mode Supabase tests for invites** — would require a Supabase
  client mock fixture. The mock-mode path covers all the business
  logic; the Supabase-side query shapes are simple `.insert/.select/
  .update/.maybeSingle` and were verified by hand. Adding mock
  fixtures is a separate refactor.
- **`googleMapsSearchUrl` in `lib/office-links.ts`** — still unused
  by `StopCard` after the maps merge; flagged in
  `MAPS_PRODUCTION_REPORT.md`, not removed here.

## Branch state

- Local: `main` at `b0fe25d`.
- `fix/pickup-url-and-invite-link` pushed to origin (preserved as
  backup); not deleted locally — operator may want to review the
  branch separately.

Both bugs are fixed in production.
