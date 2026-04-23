# Plan: Session / Cookie Migration to Supabase Auth

**Slug:** session-migration
**SPEC reference:** Tech stack (Supabase Auth). Completes STEP 4 ("cookie rewire") deferred from `docs/plans/adapter-supabase-auth.md`. Implements the v1 SPEC requirement "Logins for 3 account types" against a real Supabase-Auth backend while preserving the mock path for offline development.
**Status:** draft

## Goal
Swap the mock-grade base64-JSON `ld_session` cookie for Supabase Auth's `sb-*` access/refresh cookies when `USE_MOCKS=false`, using `@supabase/ssr`'s Next.js App Router cookie pattern. Keep the legacy `ld_session` path intact for `USE_MOCKS=true` so dev/test continues to work offline. Add a companion `ld_role` cookie so Edge middleware can still decide route access without issuing a DB query, and ship a `seed-live-accounts` script + manual verification plan.

## Out of scope
- **Password reset, email verification, MFA, signup, passwordless.** Not on v1. The login form stays email+password only.
- **RLS enforcement on the user-session client.** The new `lib/supabase-server.ts` uses the anon key + session cookies, but application code does not switch to it for data access in this feature — every business-logic path still goes through `getSupabaseAdminClient()` (service-role, RLS-bypassing) via the storage adapter. Migrating data access to RLS is a separate feature.
- **Deleting `interfaces/auth.real.ts` or the `AuthService` interface.** The mock path still uses `AuthService` via `authMock`, and `getServices().auth` is called from only two places today. Option (a) from the scope: we KEEP `auth.real.ts` and the interface, and document that in real mode the interface methods are not reachable from production code paths (the real flow lives inside `app/login/actions.ts` and `app/logout/route.ts` directly). A follow-up to retire the interface entirely is flagged in BUILD_LOG.
- **Migrating `require-driver`, `require-dispatcher`, `require-admin` to async.** `getSession()` stays synchronous from the caller's perspective in the mock path. In the real path, `getUserFromSession()` is naturally async (it does a DB lookup). Resolution: `getSession()` becomes an `async` function returning `Promise<SessionCookieValue | null>`, and every `require*Session()` helper + every page/action that calls `getSession()` becomes `await`-ed. This is a wide but mechanical change enumerated in Implementation step 9.
- **Test-account seeding as part of `seedMocks()`.** Live Supabase users are seeded by a separate CLI script (`scripts/seed-live-accounts.ts`), never at request time. The mock seeder is untouched.
- **`profiles.full_name` as a session field.** The session value stays `{ userId, role }`. Name lookup continues to be a separate query where needed (same as today).
- **Changing `evaluateAccess` or `auth-rules.ts`.** The authorization rules are unchanged; only the session resolver changes.
- **Removing `getServices().auth` from the login/logout code paths when `USE_MOCKS=true`.** The mock path still calls `getServices().auth.signIn` + `setSession`; only the real branch switches to `@supabase/ssr`.

## Files to create or modify

### New files
- `/Users/abraham/lab-dispatch/lib/supabase-server.ts` — server-only module. First line `import "server-only";`. Exports:
  - `createSupabaseServerClient(): SupabaseClient` — builds a `@supabase/ssr` `createServerClient` wired to `cookies()` from `next/headers`. Reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (not service-role). Throws `NotConfiguredError` if either env var is missing. This is the USER-SESSION client — distinct from the service-role admin client in `interfaces/supabase-client.ts`.
  - `getUserFromSession(): Promise<SessionCookieValue | null>` — calls `supabase.auth.getUser()`; if no user, returns null. Otherwise looks up `profiles.role` by `user.id` via the admin client (`getSupabaseAdminClient()`) — we use the admin client here because the anon-key client under RLS would need a policy to read its own profile row and we want this lookup to work regardless of RLS state. Returns `{ userId, role }` on success; returns null if the profile row is missing OR the role value is not one of the allowed three (defense against DB widening).
- `/Users/abraham/lab-dispatch/lib/supabase-server.test.ts` — hermetic. `vi.mock("@supabase/ssr", ...)` returns a fake `createServerClient` factory; `vi.mock("next/headers", ...)` returns a cookies stub. Cases:
  - `getUserFromSession` returns null when `auth.getUser()` returns `{ data: { user: null }, error: <any> }`.
  - `getUserFromSession` returns `{ userId, role }` when both the user and the profile row resolve.
  - `getUserFromSession` returns null when the user resolves but the profile row is missing.
  - `getUserFromSession` returns null when the profile row has an invalid role value (e.g. `"hacker"`).
  - `createSupabaseServerClient` throws `NotConfiguredError` with `envVar === "NEXT_PUBLIC_SUPABASE_URL"` when that env var is unset, and with `envVar === "NEXT_PUBLIC_SUPABASE_ANON_KEY"` when the anon key is unset.
- `/Users/abraham/lab-dispatch/lib/supabase-middleware.ts` — Edge-runtime-safe module. NOT marked `"server-only"` because it runs inside `middleware.ts` (which is neither Node nor pure server). Must not import from `next/headers`. Exports:
  - `updateSession(request: NextRequest): Promise<NextResponse>` — the canonical `@supabase/ssr` Next.js middleware helper that refreshes Supabase session cookies on every request, using `request.cookies.get(name)?.value` to read and `response.cookies.set(...)` to write. Returns a `NextResponse` whose cookies are the refreshed set; middleware.ts decides whether to return that response or a redirect based on the access decision.
  - `readSessionFromRequest(request: NextRequest): Promise<SessionCookieValue | null>` — reads the `ld_role` cookie off `request.cookies`, plus the Supabase `sb-access-token` presence check, and returns `{ userId, role }` only if both are present. `userId` comes from parsing the JWT's `sub` claim WITHOUT verifying signature (trusted only for middleware's coarse allow/deny — every server page still re-checks via `getUserFromSession()`). Returns null on any parse or format failure. Document clearly that this function is a fast-path heuristic; the authoritative resolver is `getUserFromSession()` in `lib/supabase-server.ts`.
- `/Users/abraham/lab-dispatch/lib/supabase-middleware.test.ts` — Edge-safe tests. Mocks `@supabase/ssr`. Cases:
  - `updateSession` calls `createServerClient` with the correct cookie read/write adapters wired to `request.cookies` / `response.cookies`.
  - `updateSession` calls `supabase.auth.getUser()` exactly once to trigger cookie refresh (per the `@supabase/ssr` recipe).
  - `readSessionFromRequest` returns null when `ld_role` is missing.
  - `readSessionFromRequest` returns null when the Supabase access-token cookie is missing.
  - `readSessionFromRequest` returns null when `ld_role` holds an unknown role.
  - `readSessionFromRequest` returns `{ userId, role }` on the happy path (access token has a valid `sub` claim; `ld_role` is one of the three).
  - `readSessionFromRequest` returns null when the JWT payload is malformed (non-JSON, missing `sub`, `sub` is not a non-empty string).
- `/Users/abraham/lab-dispatch/scripts/seed-live-accounts.ts` — idempotent CLI. First line is a shebang comment and a note that this is an operator tool, not app code. Uses `getSupabaseAdminClient()`. Seeds three accounts:
  - `admin@test` → role `admin`, full_name `"Test Admin"`
  - `dispatcher@test` → role `dispatcher`, full_name `"Test Dispatcher"`
  - `driver@test` → role `driver`, full_name `"Test Driver"`
  All with password `test1234` and `email_confirm: true`. For each: list users via `supabase.auth.admin.listUsers()` and search by email (Supabase does not expose `getUserByEmail` directly); if not found, call `supabase.auth.admin.createUser({ email, password, email_confirm })`. Then `upsert` the `profiles` row (`{ id: userId, role, full_name, phone: null }`). Print `OK <email> (role=<role>, user_id=<uuid>)` or `SKIPPED <email> (already exists)` per account. Exit code 0 on success, 1 on any failure with the error printed to stderr (error message must NOT include any key values). The script is run via `npm run seed-live-accounts` which shells out to `tsx --env-file=.env.local scripts/seed-live-accounts.ts`.
- `/Users/abraham/lab-dispatch/app/logout/route.test.ts` — NEW. Mocks `@supabase/ssr` + `next/headers`. Cases:
  - `GET /logout` calls `supabase.auth.signOut()` then `clearSession()` (which deletes `ld_role`) then redirects to `/login` with 303.
  - `POST /logout` same as GET.
  - When `USE_MOCKS=true`: calls `getServices().auth.signOut()` + `clearSession()` (clears `ld_session`) — this branch must still work.
  - When `supabase.auth.signOut()` throws: handler still clears the cookie and redirects (logout must be best-effort).
- `/Users/abraham/lab-dispatch/middleware.test.ts` — NEW (Edge-safe). Mocks `@supabase/ssr` and runs `middleware()` against hand-crafted `NextRequest` objects. Cases:
  - Unauthenticated request to `/driver` → redirect to `/login?next=/driver`.
  - `ld_role=driver` + valid sb access-token cookie, request to `/driver` → allow (NextResponse.next with refreshed cookies).
  - `ld_role=driver`, request to `/admin` → redirect to `/driver`.
  - Public paths (`/login`, `/pickup/xyz`) → allow without any session.
  - `USE_MOCKS=true` mode still reads `ld_session` (the old base64 cookie) and routes based on that — proves the dual-mode gate.

### Modifications
- `/Users/abraham/lab-dispatch/lib/session.ts` — **dual-mode rewrite.** Keep `SESSION_COOKIE = "ld_session"` as the mock-mode cookie name (unchanged). Add `LD_ROLE_COOKIE = "ld_role"` as the real-mode Edge-readable role cache.
  - `encodeSession` / `decodeSession` — unchanged (still used by mock mode and by middleware fallback).
  - `getSession(): Promise<SessionCookieValue | null>` — becomes `async`. Branches on `process.env.USE_MOCKS`:
    - `"true"` / unset → existing behavior: read `ld_session`, decode, return.
    - `"false"` → call `getUserFromSession()` from `lib/supabase-server.ts` and return.
    - anything else → throw (same guard as `getServices()`).
  - `setSession(userId, role): Promise<void>` — becomes `async`. In mock mode: write `ld_session` as today. In real mode: write ONLY the `ld_role` cookie (non-HTTPOnly, sameSite=lax, path=/, secure in prod). Supabase's own `sb-*` cookies are written by `supabase.auth.signInWithPassword` on the server client — `setSession` does NOT touch them. Rationale for `httpOnly: false` on `ld_role`: middleware runs in Edge and reads `request.cookies` — it CAN read httpOnly cookies, so we could leave this httpOnly. **Decision: keep `ld_role` httpOnly=true.** Middleware reads it fine; browser JS should never need to read the role; tampering detection is the job of `getUserFromSession` on the server anyway. Update the existing file-top comment to describe the dual-mode behavior and remove the "stop-gap" language.
  - `clearSession(): Promise<void>` — becomes `async`. Mock mode: delete `ld_session`. Real mode: delete `ld_role`. (Supabase's `sb-*` cookies are cleared by `supabase.auth.signOut()` on the server client.)
- `/Users/abraham/lab-dispatch/lib/session.test.ts` — expand to cover both modes. Add `vi.mock("@supabase/ssr", ...)` + `vi.mock("next/headers", ...)` + `vi.mock("@/lib/supabase-server", ...)`. Cases (new, on top of existing codec tests):
  - Mock mode (`USE_MOCKS=true`): `getSession()` reads `ld_session` via `cookies().get`; `setSession` writes `ld_session` with httpOnly + sameSite=lax; `clearSession` deletes `ld_session`.
  - Real mode (`USE_MOCKS=false`): `getSession()` calls `getUserFromSession()` and returns its value; `setSession` writes `ld_role` (NOT `ld_session`) with httpOnly=true; `clearSession` deletes `ld_role`.
  - `getSession()` throws if `USE_MOCKS` is an invalid value (belt-and-suspenders).
- `/Users/abraham/lab-dispatch/middleware.ts` — rewrite for dual mode:
  - If `USE_MOCKS === "true"` or unset: existing behavior (read `ld_session`, decode, evaluateAccess). Leave the code path intact.
  - If `USE_MOCKS === "false"`: call `await updateSession(request)` to get a `NextResponse` with refreshed Supabase cookies; call `await readSessionFromRequest(request)` for the `{ userId, role } | null` pair; run `evaluateAccess({ pathname, role })`; if allow, return the refreshed NextResponse; if redirect, return `NextResponse.redirect(...)` (the redirect inherits cookies from the request — Supabase cookie refresh is lost on this branch, which is acceptable because the redirect target will re-run middleware and refresh again).
  - The `config.matcher` is unchanged.
  - Must compile under Edge: no `next/headers`, no Node APIs. Use `request.cookies` directly. `@supabase/ssr`'s `createServerClient` is Edge-compatible.
- `/Users/abraham/lab-dispatch/app/login/actions.ts` — dual-mode rewrite:
  - Keep mock branch (`USE_MOCKS === "true"` or unset): existing flow unchanged — `getServices().auth.signIn(...)` + `setSession(userId, role)`. Now `await setSession(...)` since it's async.
  - Add real branch (`USE_MOCKS === "false"`):
    - `const supabase = createSupabaseServerClient()`
    - `const { data, error } = await supabase.auth.signInWithPassword({ email, password })`
    - On error or missing `data.user`: return `{ error: "Invalid email or password." }`.
    - Look up `profiles.role` + `profiles.full_name` via the admin client by `data.user.id`. If the row is missing OR the role value is unknown, treat as "invalid credentials" (do NOT leak the difference); additionally, call `supabase.auth.signOut()` to clear the cookies we just wrote so the half-authenticated state does not persist.
    - On success: `await setSession(data.user.id, role)` — in real mode this writes ONLY `ld_role`; Supabase's own `sb-*` cookies were written by `signInWithPassword` already.
    - `redirect(computeLandingPath(role, next))`.
  - Error-path message is the existing `"Invalid email or password."` (generic, no Supabase error leak).
- `/Users/abraham/lab-dispatch/app/login/actions.test.ts` — extend. Current test only exercises `isSafeNext`; add action-level tests that exercise both modes:
  - Mock mode happy path (existing coverage is through other harness layers, but add an explicit "signs in with admin@test and sets `ld_session`" case).
  - Mock mode invalid-password returns the error state.
  - Real mode happy path: mock `@supabase/ssr` to return `{ data: { user: { id: "uuid-1" } }, error: null }`; mock the admin client's profiles query to return `{ role: "admin" }`; assert `setSession` wrote `ld_role` with value `admin` and `redirect("/admin")` was called.
  - Real mode error from `signInWithPassword` returns `{ error: "Invalid email or password." }` with NO cookie writes.
  - Real mode success-but-missing-profile calls `supabase.auth.signOut()` AND returns the error state.
  - Must mock `@supabase/ssr` — no real HTTP.
- `/Users/abraham/lab-dispatch/app/logout/route.ts` — dual-mode rewrite:
  - Mock branch: existing flow — `await getServices().auth.signOut(); clearSession();`.
  - Real branch: `const supabase = createSupabaseServerClient(); try { await supabase.auth.signOut(); } catch {} await clearSession();` (note `clearSession` is now async).
  - Unchanged: 303 redirect to `/login`. GET + POST both accepted.
- `/Users/abraham/lab-dispatch/app/page.tsx` — `getSession()` is now async → `const session = await getSession();`. The page component is already a server component; add `async`.
- `/Users/abraham/lab-dispatch/lib/require-driver.ts` — `getSession()` is async. Functions become `async function requireDriverSession(): Promise<SessionCookieValue>` and `async function requireDriverOrAdminSession()`. Callers must `await` (enumerated in step 9).
- `/Users/abraham/lab-dispatch/lib/require-dispatcher.ts` — same async conversion.
- `/Users/abraham/lab-dispatch/lib/require-admin.ts` — same async conversion.
- `/Users/abraham/lab-dispatch/lib/require-driver.test.ts`, `lib/require-dispatcher.test.ts`, `lib/require-admin.test.ts` — update to `await` the under-test calls and mock `@/lib/session`'s `getSession` as an async function.
- `/Users/abraham/lab-dispatch/interfaces/auth.real.ts` — leave method bodies intact per scope decision (a): real adapter stays wired to the factory so `USE_MOCKS=false` does not crash at factory-construction time, but in practice production code paths no longer reach `auth.signIn` / `auth.signOut` / `auth.getCurrentUser` (the login/logout route handlers call `@supabase/ssr` directly). Update the file-top comment to call out:
  - Real mode: the interface methods are unreachable — login/logout happen in the route handlers.
  - Mock mode: `authMock` (in `mocks/auth.ts`) still uses the interface normally.
  - Follow-up flagged in BUILD_LOG: once mocks no longer need the `AuthService` abstraction, retire the interface entirely.
- `/Users/abraham/lab-dispatch/package.json` — add `"@supabase/ssr": "^0.5.0"` to `dependencies` (major version pinned at minor to accept patches; the exact latest minor is confirmed at install time). Add `"seed-live-accounts": "tsx --env-file=.env.local scripts/seed-live-accounts.ts"` under `scripts`.
- `/Users/abraham/lab-dispatch/BLOCKERS.md` — update `[supabase]` entry: cookie migration has landed. Remove or rewrite the `ld_session` workaround note to describe the new dual-mode codec. Flag the `readSessionFromRequest` unsigned-JWT trust model as a known architectural choice (not a blocker).
- `/Users/abraham/lab-dispatch/BUILD_LOG.md` — append one dated entry: session migration landed, `@supabase/ssr` added, dual-mode cookie handling, `seed-live-accounts` script added. Note the follow-up to retire the `AuthService` interface.

### NOT modified (deliberate)
- `/Users/abraham/lab-dispatch/lib/auth-rules.ts` — authorization rules unchanged.
- `/Users/abraham/lab-dispatch/interfaces/supabase-client.ts` — admin client singleton unchanged. Reused by the new code.
- `/Users/abraham/lab-dispatch/mocks/auth.ts` — mock `AuthService` unchanged; still powers `USE_MOCKS=true`.
- `/Users/abraham/lab-dispatch/supabase/schema.sql` — no migration. `profiles.role` already exists.
- `/Users/abraham/lab-dispatch/app/login/page.tsx` — the login form itself is unchanged; only the server action behind it changes.

## Interfaces / contracts

### `lib/supabase-server.ts`
```ts
import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NotConfiguredError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/interfaces/supabase-client";
import type { SessionCookieValue } from "@/lib/session";
import type { UserRole } from "@/lib/types";

export function createSupabaseServerClient(): SupabaseClient;
export function getUserFromSession(): Promise<SessionCookieValue | null>;
```

### `lib/supabase-middleware.ts`
```ts
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { SessionCookieValue } from "@/lib/session";

export async function updateSession(request: NextRequest): Promise<NextResponse>;
export async function readSessionFromRequest(
  request: NextRequest,
): Promise<SessionCookieValue | null>;
```

### `lib/session.ts` (after rewrite)
```ts
export const SESSION_COOKIE = "ld_session"; // mock mode (unchanged)
export const LD_ROLE_COOKIE = "ld_role";    // real mode (new)

export interface SessionCookieValue { userId: string; role: UserRole; }

export function encodeSession(v: SessionCookieValue): string; // mock only
export function decodeSession(raw: string | undefined): SessionCookieValue | null;

export async function getSession(): Promise<SessionCookieValue | null>;
export async function setSession(userId: string, role: UserRole): Promise<void>;
export async function clearSession(): Promise<void>;
```

### `scripts/seed-live-accounts.ts`
No exported interface; a CLI entry point. Output contract (one line per account):
```
OK admin@test (role=admin, user_id=<uuid>)
SKIPPED dispatcher@test (already exists)
OK driver@test (role=driver, user_id=<uuid>)
```
Exit 0 on success, 1 on failure (stderr prints the error, never the key or password values).

## Implementation steps

1. **Install `@supabase/ssr`.** Run `npm install @supabase/ssr` so `package.json` + `package-lock.json` update in one step. Verify the major version lands at `^0.5.x` (or latest stable at implementation time). Touch only `package.json` + `package-lock.json`.

2. **Create `lib/supabase-server.ts`.** Implement `createSupabaseServerClient()`: guard both env vars with `NotConfiguredError`; build via `createServerClient(url, anonKey, { cookies: { get(name) { return cookies().get(name)?.value; }, set(name, value, options) { cookies().set({ name, value, ...options }); }, remove(name, options) { cookies().set({ name, value: "", ...options }); } } })`. Implement `getUserFromSession()`: call `supabase.auth.getUser()`, return null on error or missing user, otherwise call `getSupabaseAdminClient().from("profiles").select("role").eq("id", data.user.id).maybeSingle()`; validate the role against `ALLOWED_ROLES` (same allowlist as `auth.real.ts`); return `{ userId, role }` or null.

3. **Create `lib/supabase-server.test.ts`.** Tests enumerated in "Files to create or modify". Use `vi.mock("@supabase/ssr", ...)` with a `createServerClient` factory that returns a controllable fake with `auth.getUser` as a `vi.fn`. Mock `@/interfaces/supabase-client` to control the profiles query. Mock `next/headers` to control the cookie jar. Add `vi.mock("server-only", () => ({}))` per the storage adapter pattern.

4. **Create `lib/supabase-middleware.ts`.** Implement `updateSession`: clone `NextResponse.next({ request })`; build a `createServerClient` whose cookie adapters read from `request.cookies` and write to BOTH `request.cookies` and the response `supabaseResponse.cookies` (the canonical `@supabase/ssr` pattern — the dual write ensures the refreshed cookie is visible to downstream code within the same request AND flushed to the browser); call `await supabase.auth.getUser()` once to trigger the refresh; return the response. Implement `readSessionFromRequest`: read `ld_role` from `request.cookies.get("ld_role")?.value`; validate against `ALLOWED_ROLES`; locate the Supabase access-token cookie (`sb-<project-ref>-auth-token` — resolve the project ref from `NEXT_PUBLIC_SUPABASE_URL`'s hostname prefix, or fall back to scanning cookie names that match `/^sb-.+-auth-token$/`); extract the JWT from the cookie (the cookie value is JSON-stringified or a plain JWT depending on `@supabase/ssr` version — handle both); parse the middle segment (`payload`) as JSON and read `sub`; return `{ userId: sub, role }` on success, null on any failure. Document that JWT signature is NOT verified here — this is an Edge fast-path heuristic, and every server resolver (`getUserFromSession`) re-validates authoritatively.

5. **Create `lib/supabase-middleware.test.ts`.** Tests enumerated above. Use hand-built `NextRequest` instances (`new NextRequest(new URL("http://localhost/driver"), { ... })` with `.cookies.set(...)` applied post-construction, since `NextRequest` in Next 14 accepts cookies via mutation). Mock `@supabase/ssr` to control `auth.getUser`.

6. **Rewrite `lib/session.ts`.** Replace the file per the "Modifications" spec. Make `getSession`, `setSession`, `clearSession` async. Branch each on `process.env.USE_MOCKS` (`"true"` / unset → mock; `"false"` → real; else throw). Import `getUserFromSession` from `./supabase-server` with a dynamic `import()` inside the real branch to avoid pulling `server-only` + `next/headers` into the middleware bundle that imports `decodeSession` alone — OR (cleaner) split `decodeSession` + `SESSION_COOKIE` into a tiny `lib/session-codec.ts` that's Edge-safe, and have `lib/session.ts` import from it. **Decision: split.** Create `lib/session-codec.ts` with `encodeSession` / `decodeSession` / `SESSION_COOKIE` (pure, Edge-safe); `lib/session.ts` re-exports them + adds the async `getSession` / `setSession` / `clearSession` + the `LD_ROLE_COOKIE` constant; `middleware.ts` imports only from `lib/session-codec.ts` in the mock branch.

7. **Update `lib/session.test.ts`.** Keep the existing codec tests (now importing from `lib/session-codec.ts` via `lib/session.ts` re-export OR directly — pick one and be consistent). Add the new dual-mode tests.

8. **Rewrite `middleware.ts`.** Dual-mode per spec. Import `decodeSession, SESSION_COOKIE` from `lib/session-codec.ts` (Edge-safe). Import `updateSession, readSessionFromRequest` from `lib/supabase-middleware.ts`. Do NOT import from `lib/session.ts` (which now pulls `next/headers`).

9. **Make `getSession` callers async.** Update every call site identified by the prior grep:
   - `lib/require-driver.ts`, `lib/require-dispatcher.ts`, `lib/require-admin.ts` — mark functions `async`, `await getSession()`.
   - `app/page.tsx` — mark component `async`, `await getSession()`.
   - `app/login/actions.ts` — `await setSession(...)`.
   - `app/logout/route.ts` — `await clearSession()`.
   - Every caller of `requireDriverSession()` / `requireDriverOrAdminSession()` / `requireDispatcherSession()` / `requireAdminSession()` across the codebase must `await` the result. Enumerate them via grep in the builder pass — the driver/dispatcher/admin UI plans already document the call sites; expect updates across `app/driver/**`, `app/dispatcher/**`, `app/admin/**`, and their test files.
   - Update `lib/require-driver.test.ts`, `lib/require-dispatcher.test.ts`, `lib/require-admin.test.ts` to await and to mock `@/lib/session`'s `getSession` as an async function.

10. **Rewrite `app/login/actions.ts`.** Dual-mode per spec. Keep `computeLandingPath`, `isSafeNext`, form-parse logic. Branch on `process.env.USE_MOCKS`. In real branch: `const supabase = createSupabaseServerClient();` then `signInWithPassword`; on success, query `profiles` via `getSupabaseAdminClient()`; on any failure, `return { error: "Invalid email or password." }` (and in the success-but-missing-profile case, call `supabase.auth.signOut()` first to clear the half-authenticated cookies); on success, `await setSession(data.user.id, role)` + `redirect(landing)`.

11. **Rewrite `app/logout/route.ts`.** Dual-mode per spec. Mock branch unchanged. Real branch: `const supabase = createSupabaseServerClient(); try { await supabase.auth.signOut(); } catch {} await clearSession();`. `redirect` to `/login` with 303 is unchanged. GET + POST both accepted.

12. **Update `app/login/actions.test.ts`.** Add the real-mode tests listed above. Must mock `@supabase/ssr` + `@/interfaces/supabase-client`.

13. **Create `app/logout/route.test.ts`.** Tests listed above.

14. **Create `middleware.test.ts`.** Tests listed above.

15. **Create `scripts/seed-live-accounts.ts`.** Idempotent seed per spec. Use `getSupabaseAdminClient()`. For each of the three accounts:
    - `const listResult = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });`
    - Search `listResult.data.users` for a match on `email.toLowerCase()`.
    - If not found: `const { data, error } = await sb.auth.admin.createUser({ email, password: "test1234", email_confirm: true });` — on error, throw with the error message (NOT the password). Capture `data.user.id`.
    - Upsert profile: `await sb.from("profiles").upsert({ id: userId, role, full_name, phone: null }, { onConflict: "id" });`.
    - Print the status line.
    - Top-level `main()` in a `try/catch` that `console.error`s and `process.exit(1)` on any failure. Exit 0 on success.
    - **NEVER log the password, the service-role key, or any cookie value.** Grep the script once for `SUPABASE_SERVICE_ROLE_KEY` or `test1234` showing up in a `console.*` string — if it does, the implementation is wrong.

16. **Add npm script.** In `package.json`: `"seed-live-accounts": "tsx --env-file=.env.local scripts/seed-live-accounts.ts"`. Mirror the exact shape of the existing `smoke-check` script.

17. **Update `interfaces/auth.real.ts` file-top comment.** Per spec — clarify that in real mode the interface methods are unreachable (route handlers talk to `@supabase/ssr` directly), and in mock mode `authMock` uses the interface normally. Flag the follow-up to retire the interface.

18. **Update `BLOCKERS.md`** and append a `BUILD_LOG.md` entry.

19. **Typecheck + test.** `npm run typecheck` and `npm test` must both pass before the feature is considered builder-complete. Every new test file must mock `@supabase/ssr` (no real HTTP).

20. **Manual verification (post-merge).** See the "Manual verification plan" section below.

## Tests to write
- `/Users/abraham/lab-dispatch/lib/supabase-server.test.ts` — NEW. Covers `createSupabaseServerClient` env-var guards and `getUserFromSession` happy-path / no-user / missing-profile / invalid-role cases.
- `/Users/abraham/lab-dispatch/lib/supabase-middleware.test.ts` — NEW. Covers `updateSession` cookie-refresh wiring and `readSessionFromRequest` happy/null/tampered cases.
- `/Users/abraham/lab-dispatch/lib/session.test.ts` — UPDATED. Keeps the codec round-trip tests; adds mock-mode and real-mode tests for the async `getSession` / `setSession` / `clearSession` helpers; covers the `USE_MOCKS` invalid-value throw.
- `/Users/abraham/lab-dispatch/middleware.test.ts` — NEW. Covers dual-mode middleware gating against `evaluateAccess`.
- `/Users/abraham/lab-dispatch/app/login/actions.test.ts` — UPDATED. Adds mock-mode action tests AND real-mode action tests (happy path, signInWithPassword error, missing-profile path calls `signOut`).
- `/Users/abraham/lab-dispatch/app/logout/route.test.ts` — NEW. Covers mock/real branches and the signOut-throws fallback.
- `/Users/abraham/lab-dispatch/lib/require-driver.test.ts`, `/Users/abraham/lab-dispatch/lib/require-dispatcher.test.ts`, `/Users/abraham/lab-dispatch/lib/require-admin.test.ts` — UPDATED to await and to treat `getSession` as async.
- Every test file MUST include `vi.mock("@supabase/ssr", ...)` where applicable. No real HTTP. No `fetch` of Supabase endpoints. No leaked env values in assertion strings.

## External services touched
- **Supabase Auth** (user sessions): wrapped by the new `lib/supabase-server.ts::createSupabaseServerClient` (anon key, user-scoped) and `lib/supabase-middleware.ts::updateSession` (Edge-safe). Interface package is `@supabase/ssr`, installed in step 1.
- **Supabase Postgres** (profile lookup): wrapped by the existing `interfaces/supabase-client.ts::getSupabaseAdminClient` (service-role). Reused unchanged for the `profiles.role` lookup in both `getUserFromSession` and the real-mode login action.
- No new SMS, email, Anthropic, or Mapbox touch points.

## Manual verification plan
After tests pass, the builder (or the operator) runs these steps in order and records the observed behavior in BUILD_LOG.md:
1. Confirm `.env.local` has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. If missing, abort — the seed script and `USE_MOCKS=false` boot both fail cleanly with `NotConfiguredError`.
2. Run `npm run seed-live-accounts`. Expected output: three `OK` (first run) or `SKIPPED` (re-run) lines. Non-zero exit = failure; do not proceed.
3. Run `USE_MOCKS=false npm run dev`. App must boot without errors.
4. Visit `http://localhost:3000/login`. Sign in as `admin@test` / `test1234`. Expected: redirect to `/admin`. Verify `/admin` renders. Open devtools → Application → Cookies; confirm the presence of `sb-<ref>-auth-token` (httpOnly) and `ld_role=admin` (httpOnly).
5. Visit `/logout` (or click Logout). Confirm redirect to `/login` and that both cookies are gone.
6. Sign in as `dispatcher@test` / `test1234`. Expected: redirect to `/dispatcher`. Verify `/dispatcher` renders. Verify navigating to `/admin` redirects to `/dispatcher` (evaluateAccess gate). Sign out.
7. Sign in as `driver@test` / `test1234`. Expected: redirect to `/driver`. Verify `/driver` renders. Verify navigating to `/dispatcher` redirects to `/driver`. Sign out.
8. Verify that `USE_MOCKS=true npm run dev` still works end-to-end with the legacy `ld_session` cookie — sign in as `admin@test` / `test1234` in mock mode and confirm `/admin` renders and that the cookie named `ld_session` (not `ld_role` and not `sb-*`) is set.
9. Record outcomes in BUILD_LOG.md. Any deviation is a bug to file before merging.

## Open questions
- **Unsigned JWT trust in middleware.** `readSessionFromRequest` parses the JWT payload without verifying the signature, trusting `ld_role` for coarse allow/deny at the Edge. A forged cookie pair would pass middleware but be rejected by every server page (`requireXSession` → `getSession` → `getUserFromSession` → authoritative Supabase check). Is this acceptable, or do we want to verify the JWT in middleware (requires the project's JWT secret to be available in Edge, i.e. stored in an env var readable at Edge runtime)? Flagged — defer to reviewer. Recommendation: accept the unsigned-JWT trust model for v1 since every authoritative check still happens server-side.
- **`ld_role` cookie scope.** Set `path=/` and `sameSite=lax`, matching `ld_session`. Should `domain` be set? Next.js defaults to host-only, which is what we want for dev and prod. No action.
- **`@supabase/ssr` major version at install time.** Spec targets `^0.5.x`. If the latest stable is `^1.x` at install, review the breaking-change notes before pinning.
- **Retiring `AuthService` interface.** Option (a) picked: keep for now because mock mode still uses it. Once we drop the mock backend for auth (or make mock-mode also route through `@supabase/ssr` against a local Supabase), we can delete `interfaces/auth.ts` + `interfaces/auth.real.ts` + `mocks/auth.ts` entirely. Tracked as a follow-up in BUILD_LOG, not this feature.
- **Does `getUserFromSession` need to handle Supabase cookie-refresh races?** `@supabase/ssr` handles this internally; `supabase.auth.getUser()` transparently refreshes on expiry. Flagged for manual confirmation during step 4 of the verification plan (if a very-short-lived session expires mid-request, does the page still render?).
