# Plan: Real Supabase Auth Adapter for AuthService

**Slug:** adapter-supabase-auth
**SPEC reference:** Tech stack (Supabase Auth). Unblocks the last remaining stub in the StorageService (`createDriver`) and completes the interface-level Supabase integration begun by `adapter-supabase-storage`. Pairs with a future STEP 4 ("cookie rewire") that swaps the mock-grade `ld_session` cookie for Supabase's `sb-*` access/refresh cookies — NOT this feature.
**Status:** draft

## Goal
Replace the three `notConfigured()` stubs inside `createRealAuthService()` with real Supabase-Auth-backed implementations (`signIn`, `signOut`, `getCurrentUser`) that reuse the admin client singleton from `interfaces/supabase-client.ts`, and simultaneously wire `createRealStorageService().createDriver` end-to-end (auth user + profiles row + drivers row) now that auth is available. Leave the `ld_session` cookie mechanism and `lib/session.ts` untouched — cookie migration is a separate, later step.

## Out of scope
- **Cookie rewire (STEP 4).** `lib/session.ts`, `app/login/actions.ts`, `app/logout/route.ts`, and `middleware.ts` keep reading/writing the `ld_session` cookie exactly as today. The real adapter's `signIn` returns `{ userId, role }` just like the mock; the calling `signInAction` continues to write the cookie via `setSession(userId, role)`. No Supabase SSR helpers, no `@supabase/ssr` package, no `sb-*` cookie reads.
- **`getCurrentUser()` as a reachable method.** Today no server code calls `AuthService.getCurrentUser` — every consumer goes through `getSession()`/`decodeSession()` in `lib/session.ts`. Because the admin client has no persistent user session to read, and because cookie-bridging belongs to STEP 4, this adapter ships `getCurrentUser()` as a scoped throw with a pointer to STEP 4. This mirrors the pattern used by `createRealStorageService().createDriver` in the storage adapter (which this feature now un-defers).
- **Test-account seeding.** The three mock accounts (`driver@test` / `dispatcher@test` / `admin@test`) are mock-only. Seeding real Supabase users is a STEP 4 concern (it needs to run once per environment and touch `auth.users` + `profiles`). This feature ships the adapter; ops seeds accounts separately.
- **Password reset, email verification enforcement, MFA, signup/registration.** None of these are on v1. The adapter only does password login, no-op signout, and the deferred getCurrentUser.
- **Service-role vs. anon client for `signInWithPassword`.** Decision below: reuse `getSupabaseAdminClient()` for consistency with storage. `signInWithPassword` is a public auth endpoint that works with either client; service-role does not leak here because the endpoint doesn't elevate privilege — it validates the password and returns a user record like any other client would. Flagged in Open Questions in case a reviewer prefers a separate anon client.
- **RLS policies.** The admin client bypasses RLS; same situation as the storage adapter.
- **New env vars.** Reuses `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` already consumed by `getSupabaseAdminClient()`.
- **Schema changes.** `profiles.role` and `profiles.full_name` already exist in `supabase/schema.sql`. No migration.

## Files to create or modify

### New files
- `/Users/abraham/lab-dispatch/interfaces/auth.real.ts` — the real adapter. First line: `import "server-only";`. Exports `createRealAuthService(): AuthService`. Uses `getSupabaseAdminClient()` from `./supabase-client`. Implements:
  - `signIn({ email, password })` — calls `supabase.auth.signInWithPassword({ email, password })`; on any error OR null user, throws `new Error("invalid credentials")` (matches mock). On success, reads `profiles.role` + `profiles.full_name` via `sb().from("profiles").select("role, full_name").eq("id", user.id).maybeSingle()`; if the row is missing, throws `new Error("invalid credentials")`. Returns `{ userId: user.id, role: row.role as UserRole }`.
  - `signOut()` — calls `supabase.auth.signOut()` on the admin client. Because the admin client does not hold a persistent user session, this is effectively a no-op on the server. The actual logout user-visible effect (cookie clearing) is already handled by `clearSession()` in `app/logout/route.ts`. Wrap the call in a best-effort try/catch and swallow errors so logout never fails due to a no-op call. Leave an inline comment pointing at STEP 4.
  - `getCurrentUser()` — throws `new Error("getCurrentUser on the real auth adapter requires the cookie migration (STEP 4 in INTEGRATION_REPORT.md)")`. Inline comment notes this is intentional — no consumer reaches it today.
- `/Users/abraham/lab-dispatch/interfaces/auth.real.test.ts` — per-method coverage against the `fake-supabase.ts` helper, extended as needed (see below). Reuses the same `vi.mock("@supabase/supabase-js", …)` + `vi.mock("server-only", () => ({}))` setup as `storage.real.test.ts`.

### Modifications
- `/Users/abraham/lab-dispatch/interfaces/auth.ts` — remove the `notConfigured()` helper and the inline stubbed body of `createRealAuthService()`; replace with a re-export so the interface file stays the import surface for shared types:
  ```ts
  export { createRealAuthService } from "./auth.real";
  ```
  The `AuthService`, `Session`, `SignInParams` interfaces stay in `auth.ts` (safe to import from client code since they're type-only). This matches the exact split used by `interfaces/storage.ts` ↔ `interfaces/storage.real.ts`.
- `/Users/abraham/lab-dispatch/interfaces/storage.real.ts` — replace the scoped throw in `createDriver` with the real 3-step implementation now that auth is wired (see Implementation step 6 for full flow). The existing inline comment that points here ("full driver creation requires `supabase.auth.admin.createUser` … belongs to the auth adapter feature") is rewritten to describe the new transactional-ish rollback behavior.
- `/Users/abraham/lab-dispatch/interfaces/storage.real.test.ts` — add/replace the existing `"createDriver throws a scoped auth-adapter-required error"` test with full-path coverage: happy path (admin.createUser → profiles insert → drivers insert), rollback on profiles-insert failure (admin.deleteUser called), rollback on drivers-insert failure (profiles row deleted + admin.deleteUser called), and rollback-on-rollback-failure logging path.
- `/Users/abraham/lab-dispatch/tests/helpers/fake-supabase.ts` — extend the `auth.admin` mock surface (currently has `listUsers` as a `vi.fn`) to also expose `createUser: vi.fn` and `deleteUser: vi.fn`, and add a sibling `auth.signInWithPassword: vi.fn` and `auth.signOut: vi.fn` on the root `auth` namespace (one level up from `auth.admin`). Update `__reset()` to `mockReset()` each of them. The new methods each default to a sensible "empty success" response — `createUser` returns `{ data: { user: null }, error: null }` until a test overrides; `signInWithPassword` returns `{ data: { user: null, session: null }, error: null }`; `signOut` returns `{ error: null }`. Update the `FakeSupabase` / `fake-supabase.test.ts` shape accordingly.
- `/Users/abraham/lab-dispatch/tests/helpers/fake-supabase.test.ts` — one new test asserting the new auth-surface methods are `vi.fn`s and survive `__reset()`.
- `/Users/abraham/lab-dispatch/BLOCKERS.md` — update the `[supabase]` entry: note that the auth adapter has now landed at `interfaces/auth.real.ts` and that the remaining work is the cookie rewire (STEP 4) which must precede any real multi-user deployment. Preserve the existing workaround description (mocks + `ld_session`).
- `/Users/abraham/lab-dispatch/BUILD_LOG.md` — append one dated entry: auth adapter wired, `createDriver` now end-to-end, `fake-supabase.ts` grew auth helpers, all tests still hermetic via `vi.mock("@supabase/supabase-js")`.

### NOT modified (deliberate)
- `/Users/abraham/lab-dispatch/lib/session.ts` — untouched. STEP 4.
- `/Users/abraham/lab-dispatch/app/login/actions.ts` — untouched. Still calls `getServices().auth.signIn(...)` and still writes the `ld_session` cookie via `setSession`. The swap from mock to real happens transparently when `USE_MOCKS=false` + env vars are set.
- `/Users/abraham/lab-dispatch/app/logout/route.ts` — untouched. Still calls `getServices().auth.signOut()` (now a real no-op on the admin client) and still calls `clearSession()`.
- `/Users/abraham/lab-dispatch/middleware.ts` — untouched. Still reads the `ld_session` cookie via `decodeSession` under the Edge runtime.
- `/Users/abraham/lab-dispatch/mocks/auth.ts` — untouched. The three seeded accounts + `resetAuthMock()` stay as-is for dev/test.
- `/Users/abraham/lab-dispatch/supabase/schema.sql` — no migration. `profiles(role, full_name)` already exists.

## Interfaces / contracts

### `interfaces/auth.real.ts` (full skeleton)
```ts
import "server-only";
import { getSupabaseAdminClient } from "./supabase-client";
import type { AuthService, Session, SignInParams } from "./auth";
import type { UserRole } from "@/lib/types";

const INVALID = "invalid credentials";
const GET_CURRENT_USER_DEFERRED =
  "getCurrentUser on the real auth adapter requires the cookie migration (STEP 4 in INTEGRATION_REPORT.md)";

const ALLOWED_ROLES: readonly UserRole[] = ["driver", "dispatcher", "admin"];

export function createRealAuthService(): AuthService {
  const sb = () => getSupabaseAdminClient();

  async function signIn(params: SignInParams): Promise<Session> {
    const { data, error } = await sb().auth.signInWithPassword({
      email: params.email,
      password: params.password,
    });
    if (error || !data?.user) {
      throw new Error(INVALID);
    }
    const userId = data.user.id;

    const profile = await sb()
      .from("profiles")
      .select("role, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (profile.error || !profile.data) {
      throw new Error(INVALID);
    }
    const role = profile.data.role as string;
    if (!ALLOWED_ROLES.includes(role as UserRole)) {
      throw new Error(INVALID);
    }
    return { userId, role: role as UserRole };
  }

  async function signOut(): Promise<void> {
    // The admin client holds no persistent user session, so this call is a
    // no-op in practice. The user-visible logout side-effect (clearing
    // `ld_session`) happens in app/logout/route.ts via `clearSession()`.
    // When STEP 4 rewires to `sb-*` cookies, this method's implementation
    // (and the caller) will change.
    try {
      await sb().auth.signOut();
    } catch {
      // never let signOut failure cascade into logout UX
    }
  }

  async function getCurrentUser(): Promise<Session | null> {
    // Intentionally scoped throw: the admin client has no user session to
    // read, and today's consumers resolve sessions via lib/session.ts's
    // getSession()/decodeSession() reading the `ld_session` cookie — not
    // via this interface method. Wiring this correctly requires the
    // cookie rewire tracked as STEP 4 in INTEGRATION_REPORT.md.
    throw new Error(GET_CURRENT_USER_DEFERRED);
  }

  return { signIn, signOut, getCurrentUser };
}
```

Guarantees:
- `signIn` throws exactly the string `"invalid credentials"` on every failure mode (wrong password, user missing, profile missing, unknown role), matching the mock and keeping `app/login/actions.ts`'s `catch { return { error: "Invalid email or password." }; }` working unchanged.
- `signOut` never throws (best-effort swallow) — guarantees logout flow is robust whether or not Supabase auth is reachable.
- `getCurrentUser` throws a unique, scoped message that points at STEP 4 so any accidental future caller gets a clear diagnostic instead of a null-pointer error.

### `interfaces/storage.real.ts` — new `createDriver` body (replacing the current scoped throw)
```ts
async function createDriver(input: NewDriver): Promise<Driver> {
  // Multi-step, non-transactional across auth + Postgres. Rollback is
  // best-effort: if any step after the auth.admin.createUser fails, we
  // attempt to delete the auth user we just created. If that rollback
  // itself fails, we log and continue — the failed email will be
  // unclaimable until an admin manually deletes it via Supabase.
  const email = input.email;
  const password = TEMPORARY_DRIVER_PASSWORD; // "test1234"; see comment

  const created = await sb().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data?.user) {
    throw wrapSupabaseError(
      { code: "auth", message: created.error?.message },
      "createDriver (auth.admin.createUser)",
    );
  }
  const userId = created.data.user.id;

  const rollbackAuth = async (context: string) => {
    try {
      await sb().auth.admin.deleteUser(userId);
    } catch (e) {
      console.warn(
        `createDriver rollback failed at ${context} for user ${userId}:`,
        e,
      );
    }
  };

  const profInsert = await sb().from("profiles").insert({
    id: userId,
    role: "driver",
    full_name: input.fullName,
    phone: input.phone ?? null,
  });
  if (profInsert.error) {
    await rollbackAuth("profiles insert");
    throw wrapSupabaseError(profInsert.error, "createDriver (profiles insert)");
  }

  const drvInsert = await sb()
    .from("drivers")
    .insert({
      profile_id: userId,
      vehicle_label: input.vehicleLabel ?? null,
      active: input.active,
    })
    .select("profile_id, vehicle_label, active, created_at, profiles(full_name, phone)")
    .single();
  if (drvInsert.error) {
    // Roll back profiles FIRST (drivers FK references profiles), then auth.
    try {
      const profDel = await sb().from("profiles").delete().eq("id", userId);
      if (profDel.error) {
        console.warn(
          `createDriver rollback: profiles delete failed for ${userId}:`,
          profDel.error,
        );
      }
    } catch (e) {
      console.warn(`createDriver rollback: profiles delete threw for ${userId}:`, e);
    }
    await rollbackAuth("drivers insert");
    throw wrapSupabaseError(drvInsert.error, "createDriver (drivers insert)");
  }

  return dbDriverToDriver(drvInsert.data as unknown as DbDriverRow);
}
```
- The `TEMPORARY_DRIVER_PASSWORD = "test1234"` constant lives at the top of `storage.real.ts`. Inline comment explains it's a temporary seed — the admin will issue a password reset via Supabase after creation. Not a secret to protect.
- `NewDriver` already includes `email`, `fullName`, optional `phone`, optional `vehicleLabel`, `active` (confirmed via the existing mock + interface — see `listDriverAccounts` consumers).
- Schema note: `drivers.profile_id` is `uuid references profiles(id) on delete cascade`; `profiles.id` is `uuid references auth.users(id) on delete cascade`. So a raw `DELETE FROM auth.users WHERE id = ...` would cascade both child rows. We still delete `profiles` explicitly to avoid depending on cascade order if the auth delete partially fails.

### `tests/helpers/fake-supabase.ts` — additions
```ts
export interface FakeSupabase {
  from(table: string): FakeQuery;
  auth: {
    signInWithPassword: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    admin: {
      listUsers: ReturnType<typeof vi.fn>;
      createUser: ReturnType<typeof vi.fn>;
      deleteUser: ReturnType<typeof vi.fn>;
    };
  };
  rpc: ReturnType<typeof vi.fn>;
  // … existing __enqueue / __calls / __reset …
}
```
Defaults:
- `signInWithPassword` → `{ data: { user: null, session: null }, error: null }`
- `signOut` → `{ error: null }`
- `admin.createUser` → `{ data: { user: null }, error: null }`
- `admin.deleteUser` → `{ data: null, error: null }`

`__reset()` calls `mockReset()` + `mockImplementation(...)` for each so every test starts pristine.

## Implementation steps

1. **Extend `fake-supabase.ts`.** Add the four new `vi.fn`s on `auth` and `auth.admin` with the default implementations listed above. Update the exported `FakeSupabase` TS type. Extend `__reset()` to cover them. Run `fake-supabase.test.ts` (add one assertion covering the new surface) and confirm green. This unblocks both the new auth tests AND the updated `createDriver` tests that follow.
2. **Write `interfaces/auth.real.ts`.** Implement per the skeleton above. Keep the file small — the adapter is ~60 lines. Lazy `sb()` per call to match storage's pattern. Export `createRealAuthService` as the only public symbol.
3. **Swap `interfaces/auth.ts`.** Delete the inline stubs + `notConfigured()` helper. Replace with `export { createRealAuthService } from "./auth.real";`. Keep the type exports (`AuthService`, `Session`, `SignInParams`) untouched. Confirm `interfaces/index.ts` still imports cleanly (no shape change — it goes through the `auth.ts` re-export).
4. **Write `interfaces/auth.real.test.ts`.** Mirror the structure of `storage.real.test.ts`: `vi.hoisted` holder, `vi.mock("@supabase/supabase-js", ...)` returning the shared fake, `vi.mock("server-only", () => ({}))` (or rely on the global `vitest.setup.ts` stub added in the storage adapter feature), `beforeEach` that stubs env, resets the supabase admin singleton, and instantiates a fresh fake. Tests:
   - `signIn — happy path, each of 3 roles`: one parametrized `it.each` over `["driver", "dispatcher", "admin"]`. For each: mock `signInWithPassword` to resolve `{ data: { user: { id: "u-role" } }, error: null }`, enqueue a `profiles` select response `{ data: { role, full_name: "X" }, error: null }`, call `signIn`, assert the returned `{ userId: "u-role", role }`.
   - `signIn — invalid credentials throws "invalid credentials"`: mock `signInWithPassword` to resolve `{ data: { user: null }, error: { message: "Invalid login credentials" } }`. Assert rejection `toThrow("invalid credentials")`. Confirm `profiles` table was never queried (`fakeClient.__calls().filter(c => c.table === "profiles")` is empty).
   - `signIn — missing profile throws "invalid credentials"`: mock `signInWithPassword` to resolve a valid user, enqueue `profiles` select with `{ data: null, error: null }`. Assert `toThrow("invalid credentials")`.
   - `signIn — profile with unknown role throws "invalid credentials"`: enqueue `profiles` select with `{ data: { role: "unknown_role" }, error: null }`. Assert `toThrow("invalid credentials")`. (Guards against `profiles.role` somehow holding a non-enum value.)
   - `signIn — profile-read error throws "invalid credentials"`: enqueue `profiles` select with `{ data: null, error: { code: "PGRST123", message: "…" } }`. Assert `toThrow("invalid credentials")` (generic error surface — we do NOT leak DB error details to the login form).
   - `signOut — calls auth.signOut on the admin client`: call `authService.signOut()`, assert `fakeClient.auth.signOut` was called exactly once with no args. Repeat with `signOut` configured to reject — assert the method still resolves (no throw).
   - `getCurrentUser — throws scoped error`: `await expect(authService.getCurrentUser()).rejects.toThrow(/STEP 4/)`.
5. **Rewire `createDriver` in `interfaces/storage.real.ts`.** Replace the existing scoped throw with the full 3-step + rollback body from the contract section. Add `const TEMPORARY_DRIVER_PASSWORD = "test1234";` at the top of the file (near `nowIso`). Delete the `void _input;` + the old throw. Update the block comment to describe the new behavior + the non-transactional caveat.
6. **Update `interfaces/storage.real.test.ts` — driver creation coverage.** Replace the existing `"createDriver throws a scoped auth-adapter-required error"` test with:
   - `createDriver — happy path`: mock `auth.admin.createUser` to resolve `{ data: { user: { id: "u1" } }, error: null }`, enqueue a `profiles` insert success (`{ data: null, error: null }`), enqueue a `drivers` insert success (single-row with joined profiles), call `createDriver`, assert the returned `Driver.profileId === "u1"` and `fullName` matches the joined row.
   - `createDriver — auth.admin.createUser failure throws, no DB calls`: mock `createUser` to resolve `{ data: { user: null }, error: { message: "boom" } }`. Expect rejection. Assert `fakeClient.__calls()` contains no `profiles` or `drivers` entries. Assert `auth.admin.deleteUser` was NOT called (nothing to roll back).
   - `createDriver — profiles insert failure rolls back auth user`: `createUser` succeeds, `profiles` insert returns `{ error: { code: "23505" } }`. Expect rejection. Assert `auth.admin.deleteUser` was called exactly once with `"u1"`. Assert `drivers` was never touched.
   - `createDriver — drivers insert failure rolls back profiles then auth`: `createUser` + `profiles` insert succeed; `drivers` insert returns `{ error: { code: "23503" } }`. Expect rejection. Assert `profiles` delete was called (`fakeClient.__calls()` contains `{ table: "profiles", method: "delete" }` + a matching `.eq("id", "u1")`). Assert `auth.admin.deleteUser` was called exactly once with `"u1"`.
   - `createDriver — rollback-delete auth failure does not mask original error`: `createUser` succeeds, `profiles` insert fails, `auth.admin.deleteUser` also rejects. Expect the ORIGINAL `createDriver (profiles insert)` error to surface (not the rollback error). Spy `console.warn` and assert it was called with a rollback warning; restore the spy.
7. **Run the full suite.** `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Every pre-existing test must still pass. The removed "createDriver throws scoped" test is replaced by the five new tests above; all other `storage.real.test.ts` cases remain identical. `auth.real.test.ts` + the extended `fake-supabase.test.ts` are the only genuinely new test files.
8. **Update BLOCKERS.md + BUILD_LOG.md.** Per the Modifications list. BLOCKERS's `[supabase]` entry now reads "interface-level adapters complete; cookie rewire (STEP 4) remaining before real multi-user deployment."

## Tests to write
- `/Users/abraham/lab-dispatch/interfaces/auth.real.test.ts` — covers every `AuthService` method against the fake client:
  - `signIn` happy path × 3 roles.
  - `signIn` invalid credentials (all four failure modes) throws the single string `"invalid credentials"`.
  - `signIn` with missing profile throws `"invalid credentials"`.
  - `signIn` with unknown `profiles.role` value throws `"invalid credentials"`.
  - `signIn` with DB error during profile read throws `"invalid credentials"` (no detail leak).
  - `signOut` calls `supabase.auth.signOut` once; never throws even if the underlying call rejects.
  - `getCurrentUser` throws with the scoped `STEP 4` message.
- `/Users/abraham/lab-dispatch/tests/helpers/fake-supabase.test.ts` — one added assertion: `auth.signInWithPassword`, `auth.signOut`, `auth.admin.createUser`, `auth.admin.deleteUser` exist as `vi.fn`s and `__reset()` resets them.
- `/Users/abraham/lab-dispatch/interfaces/storage.real.test.ts` — five updated `createDriver` tests (see Implementation step 6). The removed test is the now-invalid "scoped auth-adapter-required error" case.

All tests mock `@supabase/supabase-js` via the `vi.hoisted` holder pattern — zero real HTTP.

## External services touched
- **Auth — Supabase Auth.** Wrapped by `interfaces/auth.real.ts` (new) + `interfaces/auth.ts` (interface + re-export). Admin endpoints used: `auth.signInWithPassword`, `auth.signOut`, `auth.admin.createUser`, `auth.admin.deleteUser`. All calls go through the shared `getSupabaseAdminClient()` singleton in `interfaces/supabase-client.ts`. No new env vars.
- No changes to SMS / email / Anthropic / Mapbox / other external wrappers.

## Open questions
1. **Use admin client or anon client for `signInWithPassword`?** Spec calls out the admin client for consistency. The public auth endpoint works with either, and using service-role here doesn't elevate privilege (password validation is symmetric). Proposed resolution: **admin client**, as specified — one fewer singleton to manage, and the auth adapter already needs admin for `createUser` in `storage.real.ts::createDriver`. If a reviewer prefers defense-in-depth (separate anon client for user-facing login), adding a second `getSupabaseAnonClient()` singleton is a ~15-line follow-up and doesn't change the adapter shape.
2. **`INTEGRATION_REPORT.md` doesn't exist yet in the repo.** The scoped `getCurrentUser` error message references "STEP 4 in INTEGRATION_REPORT.md" per the feature brief. Two options: (a) ship the error string verbatim anticipating the doc will exist by the time anyone hits the throw, or (b) soften to "STEP 4 of the integration plan" until the doc lands. **Proposed resolution:** (a). The string is a diagnostic for developers, not user-facing copy, and having a stable symbol (`INTEGRATION_REPORT.md`) to grep for once the doc lands is worth a tiny window of staleness.
3. **`auth.admin.createUser` + `password: "test1234"`.** A shared temporary password for all newly-created drivers is acceptable for v1 dev/staging but should not persist into production. Proposed resolution: flag in BLOCKERS.md and BUILD_LOG.md; replace with a random password + immediate password-reset email in a follow-up ("driver onboarding flow") after STEP 4. Not in scope for this feature.
4. **Rollback semantics across auth + Postgres are not transactional.** The plan uses best-effort rollback with `console.warn` on rollback failure. This can leak an orphaned `auth.users` row if the rollback delete itself fails (rare — the admin-client delete typically succeeds since the row was just created). Proposed resolution: accept for v1; a future follow-up could use a Postgres RPC that wraps all three steps atomically once the Supabase project has a trusted server-side function for `auth.admin.*`. Flag in BLOCKERS.md.
5. **Does `profiles.role` need an explicit enum guard?** `schema.sql` defines `profiles.role` as the `public.user_role` enum, so Supabase should only ever return one of `"driver" | "dispatcher" | "admin"`. The plan still validates against `ALLOWED_ROLES` defensively (returning the generic `"invalid credentials"` on mismatch) rather than trusting the DB — this protects against an accidental enum widening in a future migration. Flagging for reviewer sign-off; can be dropped if considered over-cautious.
