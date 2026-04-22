# Plan: Auth Skeleton (Login + Route Protection)

**Slug:** auth-skeleton
**SPEC reference:** "Logins for 3 account types" (v1 features IN). Consumes the port/adapter seam built in `interface-layer` (specifically `interfaces/auth.ts` + `mocks/auth.ts`). Establishes the auth boundary every later feature (driver route view, dispatcher map/queue, admin CRUD) will rely on for session + role checks.
**Status:** draft

## Goal
Give each of the three account types (driver, dispatcher, admin) a working email+password login flow, a session cookie that persists across requests, and a middleware that routes users into the correct role-scoped tree — all powered by `getServices().auth` so the mock backs it today and Supabase Auth replaces it later. No real UI lives behind the gate yet; placeholder role pages exist only to prove the middleware.

## Out of scope
- Registration / signup flow (v1 has none — admins create users via admin UI in feature `f`).
- Password reset.
- Email verification.
- MFA / second factor.
- Real Supabase Auth wiring — the real adapter stays a stub that throws `NotConfiguredError`; this feature only uses the mock.
- Refresh tokens, session expiry, sliding windows — the mock cookie is session-lifetime only.
- Any driver / dispatcher / admin product UI beyond a one-line "Hello {fullName}" placeholder. Real UIs land in features `f`/`g`/`h`.
- Server-action or page-render integration / E2E tests (see "Tests to write" — explicitly skipped as too much scaffolding for a skeleton).
- CSRF tokens beyond Next.js's default server-action protection.
- Rate-limiting the login endpoint.
- Remember-me checkbox / "stay signed in" UX.
- Per-office `/pickup/*` access rules beyond "public path" (that feature owns its own link-token validation).

## Files to create or modify

### New: session helper
- `/Users/abraham/lab-dispatch/lib/session.ts` — thin wrapper over `cookies()` from `next/headers`. Exports `getSession()`, `setSession(userId, role)`, `clearSession()`, plus the cookie name constant `SESSION_COOKIE = "ld_session"`. Encoding is base64(JSON.stringify({ userId, role })). File-top comment marks this "mock-grade" and points at the `supabase` BLOCKERS entry.
- `/Users/abraham/lab-dispatch/lib/session.test.ts` — unit tests for encode/decode round-trip, null cookie, malformed cookie (bad base64, valid base64 but bad JSON, valid JSON with wrong shape / unknown role).

### New: pure middleware rules
- `/Users/abraham/lab-dispatch/lib/auth-rules.ts` — pure function `evaluateAccess({ pathname, role })` where `role: UserRole | null`. Returns `{ action: "allow" } | { action: "redirect"; to: string }`. No Next.js imports — pure TS so it can be unit-tested without a Next runtime. Also exports two small constants used by both this module and `middleware.ts`: `PUBLIC_PATH_PREFIXES` (array of string prefixes) and `PROTECTED_TREES` (record mapping each role to its root path, e.g. `{ driver: "/driver", dispatcher: "/dispatcher", admin: "/admin" }`).
- `/Users/abraham/lab-dispatch/lib/auth-rules.test.ts` — covers every cell of the truth table: public paths, unauthenticated access to each protected tree, each role × each protected tree, plus a handful of exact-path edge cases (trailing slash, query string, nested path).

### New: Next.js middleware
- `/Users/abraham/lab-dispatch/middleware.ts` — project-root middleware. Thin wrapper: reads the session cookie, decodes it inline (cannot import `lib/session.ts` because that file uses `next/headers` which is not available in the Edge middleware runtime), feeds `{ pathname, role }` into `evaluateAccess()`, and either `NextResponse.next()` or `NextResponse.redirect(new URL(to, request.url))`. Exports a `config` with a `matcher` excluding `/_next/*`, static files, and public paths so the middleware doesn't run on them (belt-and-suspenders with the `evaluateAccess` allow rule).

### New: login flow
- `/Users/abraham/lab-dispatch/app/login/page.tsx` — client component. Renders a form (email, password, submit). Reads `next` from `useSearchParams` and forwards it into the server action as a hidden input. Shows an error message returned by the server action (using `useFormState` from `react-dom`). Has a link back to `/` for cancel.
- `/Users/abraham/lab-dispatch/app/login/actions.ts` — server action `signInAction(prevState, formData)`. Reads `email`, `password`, `next` from `formData`; calls `getServices().auth.signIn({ email, password })`; on success calls `setSession(userId, role)` then `redirect(computeLandingPath(role, next))` from `next/navigation`; on failure returns `{ error: "Invalid email or password." }`. Treats any thrown error as invalid-credentials (the mock throws `Error("invalid credentials")`; real Supabase will throw something else and this same copy is still correct for the user). `computeLandingPath` is an inner helper that returns `next` if it is a safe in-app absolute path (starts with `/` and does not start with `//` — prevents open redirects) AND is allowed for this role by `evaluateAccess`; otherwise returns the role's default landing (`/driver`, `/dispatcher`, `/admin`).
- `/Users/abraham/lab-dispatch/app/logout/route.ts` — route handler (GET + POST both accepted). Calls `getServices().auth.signOut()` then `clearSession()` then returns `NextResponse.redirect(new URL("/login", request.url))`. Accepting GET keeps the placeholder role pages' "Logout" link simple (a plain `<a href="/logout">`); accepting POST lets later UIs use a real form submission.

### New: role-scoped placeholder pages
- `/Users/abraham/lab-dispatch/app/driver/page.tsx` — server component. Calls `getSession()`; if null (shouldn't happen thanks to middleware, but a belt-and-suspenders `redirect("/login")` guards against misconfiguration). Fetches the driver's display name — for v1 skeleton, just pass the `userId` through; the actual name lookup lands when the admin CRUD feature gives storage real users. For now, render `"Hello, driver {userId}"` and a `<a href="/logout">Log out</a>` link.
- `/Users/abraham/lab-dispatch/app/dispatcher/page.tsx` — same pattern as `/driver/page.tsx`, role label "dispatcher".
- `/Users/abraham/lab-dispatch/app/admin/page.tsx` — same pattern, role label "admin".

### Modifications
- `/Users/abraham/lab-dispatch/app/page.tsx` — keep the existing placeholder heading and tagline, but make it an `async` server component that calls `getSession()`. If a session exists, `redirect()` to the role-appropriate landing. If not, add a "Sign in" link pointing at `/login` underneath the tagline. Keep existing Tailwind styling.
- `/Users/abraham/lab-dispatch/BLOCKERS.md` — amend the existing `[supabase]` entry's "Workaround in place" line to note: "The `ld_session` cookie set by `lib/session.ts` is base64 JSON — explicitly mock-grade; real Supabase Auth will replace this with its own cookies (sb-* access/refresh tokens) when wiring lands, and `lib/session.ts` will be rewritten or removed." This is the single explicit reminder.
- `/Users/abraham/lab-dispatch/BUILD_LOG.md` — append a dated entry summarizing what shipped. Format matches the interface-layer entry.

No changes to `interfaces/auth.ts`, `mocks/auth.ts`, or `lib/types.ts` — the auth interface already exposes exactly what this feature needs.

## Interfaces / contracts

### `lib/session.ts`
```ts
import type { UserRole } from "@/lib/types";

export const SESSION_COOKIE = "ld_session";

export interface SessionCookieValue {
  userId: string;
  role: UserRole;
}

export function getSession(): SessionCookieValue | null;
export function setSession(userId: string, role: UserRole): void;
export function clearSession(): void;

// Exposed for testing the codec without the cookie store.
export function encodeSession(value: SessionCookieValue): string;
export function decodeSession(raw: string | undefined): SessionCookieValue | null;
```
Behavior:
- `encodeSession({ userId, role })` → `Buffer.from(JSON.stringify({ userId, role })).toString("base64")`.
- `decodeSession(undefined)` → `null`. `decodeSession("")` → `null`. Any throw during base64 decode, JSON.parse, or schema validation → return `null` (swallow, never throw; middleware treats this as unauthenticated).
- Schema validation accepts only objects with `typeof userId === "string"`, non-empty `userId`, and `role` in `{"driver","dispatcher","admin"}`; anything else → `null`.
- `setSession` writes the cookie with `httpOnly: true`, `sameSite: "lax"`, `path: "/"`, `secure: process.env.NODE_ENV === "production"`. No `maxAge` (session cookie, cleared when browser closes — matches the "mock-grade" note).
- `clearSession` deletes the cookie via `cookies().delete(SESSION_COOKIE)`.
- `getSession` calls `cookies().get(SESSION_COOKIE)?.value` then `decodeSession`.

### `lib/auth-rules.ts`
```ts
import type { UserRole } from "@/lib/types";

export const PUBLIC_PATH_PREFIXES: readonly string[] = [
  "/login",
  "/logout",
  "/pickup/",    // per-office pickup forms (feature lands later)
  "/api/",       // webhooks
  "/_next/",
  "/favicon",
];

export const PROTECTED_TREES: Record<UserRole, string> = {
  driver: "/driver",
  dispatcher: "/dispatcher",
  admin: "/admin",
};

export interface EvaluateAccessInput {
  pathname: string;
  role: UserRole | null;
}

export type AccessDecision =
  | { action: "allow" }
  | { action: "redirect"; to: string };

export function evaluateAccess(input: EvaluateAccessInput): AccessDecision;
export function isPublicPath(pathname: string): boolean;
export function landingPathFor(role: UserRole): string;
```
Rules (checked top-down, first match wins):
1. `pathname === "/"` → allow. (Root page's own server component handles redirect-when-signed-in.)
2. `isPublicPath(pathname)` → allow. Matches when `pathname === "/login"` OR `pathname === "/logout"` OR `pathname` starts with any prefix ending in `/` (e.g. `/pickup/abc`, `/api/webhooks/twilio`, `/_next/static/...`). Also matches literal `/favicon.ico` via the `"/favicon"` prefix.
3. `pathname` starts with `/driver`, `/dispatcher`, or `/admin`:
   - If `role === null` → redirect to `/login?next=${encodeURIComponent(pathname)}`.
   - If role is `admin` → allow (admin can access all three trees).
   - If role is `dispatcher`:
     - `/dispatcher*` → allow.
     - `/driver*` or `/admin*` → redirect to `/dispatcher`.
   - If role is `driver`:
     - `/driver*` → allow.
     - `/dispatcher*` or `/admin*` → redirect to `/driver`.
4. Any other path → allow (default-allow for unrecognized routes; the middleware matcher already excludes static files, so this only affects user-authored routes outside the three protected trees).

Notes:
- Prefix matching for trees uses exact-or-with-slash (`pathname === "/driver" || pathname.startsWith("/driver/")`) to prevent `/driverhack` from being mistaken for `/driver`.
- `landingPathFor(role)` just returns `PROTECTED_TREES[role]`.

### `app/login/actions.ts`
```ts
"use server";

export interface SignInFormState {
  error: string | null;
}

export async function signInAction(
  prevState: SignInFormState,
  formData: FormData,
): Promise<SignInFormState>; // on success throws via `redirect()`; never returns normally
```

### `middleware.ts`
```ts
import { NextResponse, type NextRequest } from "next/server";
import { evaluateAccess } from "@/lib/auth-rules";
import type { UserRole } from "@/lib/types";
import { SESSION_COOKIE } from "@/lib/session"; // safe: only imports the string constant; next/headers is not touched

export function middleware(request: NextRequest): NextResponse;

export const config = {
  matcher: [
    // Run on everything except Next internals and obvious static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|txt|xml)).*)",
  ],
};
```
Behavior inside `middleware`:
1. Read the `ld_session` cookie value from `request.cookies.get(SESSION_COOKIE)?.value`.
2. Inline-decode (same logic as `decodeSession`) — base64 → JSON → shape-check. Any failure → `role = null`. The duplication here is load-bearing: `middleware.ts` runs in the Edge runtime where `next/headers` is not available, so it cannot call `getSession()` directly. The inline decoder is a tiny function (≤15 lines) and both copies (here + `lib/session.ts`) delegate to the same logic by both importing `decodeSession` from `@/lib/session` — verify that `lib/session.ts` itself keeps `decodeSession` free of any `cookies()` call or other `next/headers` import so it is Edge-safe. (If TypeScript or the build surfaces an Edge-runtime error from importing `lib/session.ts` at all, fall back to inlining the decoder in `middleware.ts` and duplicating with a comment.)
3. Call `evaluateAccess({ pathname: request.nextUrl.pathname, role })`.
4. On `allow` → `NextResponse.next()`. On `redirect` → `NextResponse.redirect(new URL(decision.to, request.url))`.

## Implementation steps

1. **Session helper.** Create `/Users/abraham/lab-dispatch/lib/session.ts` per the contract. Top of file: a block comment stating "mock-grade cookie — will be replaced by Supabase Auth cookies; see BLOCKERS.md [supabase]". Implement `encodeSession`, `decodeSession` (total function; never throws), `getSession`, `setSession`, `clearSession`. `getSession`/`setSession`/`clearSession` import `cookies` from `next/headers`; `encodeSession`/`decodeSession` do not. Re-export `SESSION_COOKIE`.
2. **Session tests.** Create `/Users/abraham/lab-dispatch/lib/session.test.ts`. Test the pure codec only (no cookie-store mocking needed because the codec is isolated):
   - Round-trip: `decodeSession(encodeSession({ userId: "u1", role: "admin" }))` deep-equals the input.
   - `decodeSession(undefined)` and `decodeSession("")` both return `null`.
   - Malformed cases each return `null`: non-base64 string (`"!!!"`), base64 of non-JSON (`Buffer.from("hello").toString("base64")`), base64 of JSON with wrong shape (`{}`), base64 of JSON with `role: "hacker"`, base64 of JSON with numeric `userId`.
   - Run `npm run test` and confirm pass before moving on.
3. **Auth rules.** Create `/Users/abraham/lab-dispatch/lib/auth-rules.ts` per the contract. No Next imports. Implement `isPublicPath`, `evaluateAccess`, `landingPathFor`. Export the two constants.
4. **Auth rules tests.** Create `/Users/abraham/lab-dispatch/lib/auth-rules.test.ts`. Cases:
   - Public paths allowed for every role *and* for null role: `/`, `/login`, `/logout`, `/pickup/foo-abc`, `/api/webhooks/twilio`, `/_next/static/chunks/x.js`, `/favicon.ico`.
   - Unauthenticated (`role: null`) visiting `/driver`, `/dispatcher`, `/admin`, `/driver/route`, `/admin/users` → each redirects to `/login?next=<original>` with the pathname URL-encoded.
   - Driver visiting `/driver` / `/driver/route` → allow. Driver visiting `/dispatcher`, `/admin/users` → redirect to `/driver`.
   - Dispatcher visiting `/dispatcher` → allow; visiting `/driver`, `/admin` → redirect to `/dispatcher`.
   - Admin visiting `/driver`, `/dispatcher`, `/admin` → all allow.
   - Edge: `/driverhack` (no slash boundary) is NOT treated as a `/driver` path and therefore falls through to the default-allow branch. Document this in the test.
   - Edge: unrecognized non-public path like `/blog` with null role → allow (default-allow). This encodes the "only the three trees are protected" rule explicitly.
   - Run `npm run test`; all new tests pass.
5. **Middleware.** Create `/Users/abraham/lab-dispatch/middleware.ts` per the contract. Import `decodeSession` and `SESSION_COOKIE` from `@/lib/session`. If the build chokes on importing `lib/session.ts` into an Edge-runtime module (because even the unused `cookies()` call is picked up by static analysis), inline the decoder: 10–15 lines of `atob`+`JSON.parse`+shape-check. Verify with `npm run build` — Next will surface any Edge-runtime import violations.
6. **Login page (client).** Create `/Users/abraham/lab-dispatch/app/login/page.tsx` as a client component (`"use client"`). Use `useFormState(signInAction, { error: null })` to wire the error display; render the form with `action={formAction}`. Email input `type="email"`, password input `type="password"`, both `required`. Hidden input `name="next"` populated from `useSearchParams().get("next") ?? ""`. Submit button reads "Sign in". If `state.error` is set, render a paragraph with `role="alert"` and the error text. Below the form, a short "test credentials" block listing the three mock accounts and the `test1234` shared password — this is mock-grade UX and gets removed when Supabase Auth lands (add a code comment saying so).
7. **Login server action.** Create `/Users/abraham/lab-dispatch/app/login/actions.ts` with `"use server"` at the top. Implement `signInAction`:
   - Extract `email`/`password`/`next` from `formData` (`String(formData.get(...) ?? "")`).
   - If email or password is empty, return `{ error: "Please enter email and password." }`.
   - Call `await getServices().auth.signIn({ email, password })`. On throw, return `{ error: "Invalid email or password." }`.
   - On success, call `setSession(session.userId, session.role)`.
   - Compute landing path: if `next` starts with `/` and does NOT start with `//`, AND `evaluateAccess({ pathname: next, role: session.role }).action === "allow"`, use `next`; else use `landingPathFor(session.role)`.
   - `redirect(landing)` from `next/navigation`. (`redirect` throws a special error Next catches — do NOT wrap in try/catch.)
8. **Logout route.** Create `/Users/abraham/lab-dispatch/app/logout/route.ts` exporting `GET` and `POST` handlers (can be `export const GET = handler; export const POST = handler;`). Handler: `await getServices().auth.signOut()`, `clearSession()`, return `NextResponse.redirect(new URL("/login", request.url), { status: 303 })`. 303 so a POST from a form becomes a GET on `/login`.
9. **Role landings.** Create `/Users/abraham/lab-dispatch/app/driver/page.tsx`, `/Users/abraham/lab-dispatch/app/dispatcher/page.tsx`, `/Users/abraham/lab-dispatch/app/admin/page.tsx`. Each is an `async` server component: call `const session = getSession();`, if `!session || session.role !== "<expected>"` then `redirect("/login")` (defensive — middleware should have handled it). Render `<main>` with `<h1>` showing the role, a `<p>` reading `Hello, ${role} ${session.userId}`, and a `<a href="/logout">Log out</a>`. Admin's page renders a small `<nav>` with links to `/driver`, `/dispatcher`, `/admin` to manually prove admin cross-tree access; the admin check in this page uses `role !== "admin"` (not a per-tree check) so the admin page itself is still guarded.
10. **Root page.** Edit `/Users/abraham/lab-dispatch/app/page.tsx` to be an `async` server component. `const session = getSession(); if (session) redirect(landingPathFor(session.role));`. Otherwise render the existing heading + tagline, plus a Tailwind-styled "Sign in" link pointing to `/login`. Keep the existing copy verbatim.
11. **BLOCKERS.md update.** Edit the existing `[supabase]` entry's "Workaround in place" to append the note about `lib/session.ts` being mock-grade and the `ld_session` cookie being replaced when Supabase Auth lands. Do not add a new top-level entry — this is a refinement of the existing one.
12. **BUILD_LOG.md entry.** Append a dated entry summarizing: files created, the `evaluateAccess` pure function, the mock-grade cookie strategy + its documentation pointer, placeholder role pages, explicit decision to skip E2E tests at this stage.
13. **Verification gate.** Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. All four must pass. The two new test files must appear in Vitest output and pass. Manual smoke (documented, not scripted): `npm run dev`, visit `/driver` → redirect to `/login?next=%2Fdriver`, sign in as `driver@test` / `test1234` → lands on `/driver`, click "Log out" → back to `/login`. Repeat for dispatcher and admin. Manual smoke is not a gate (no E2E runner yet) but the builder should perform it and note the result in the BUILD_LOG entry.

## Tests to write

- `/Users/abraham/lab-dispatch/lib/session.test.ts` — `encodeSession`/`decodeSession` round-trip; `decodeSession` returns `null` for `undefined`, `""`, non-base64, base64 of non-JSON, base64 of JSON with wrong shape (empty object, numeric `userId`, invalid `role` value, missing `role` field). No mocking of `cookies()` — tests only the pure codec functions.
- `/Users/abraham/lab-dispatch/lib/auth-rules.test.ts` — full truth table per step 4 above: public paths × all roles (including null); unauthenticated hits to each protected tree redirect to `/login?next=...` (with URL-encoding); each role × each protected tree produces the expected allow/redirect decision; `/driverhack`-style prefix-collision edge case; unrecognized path default-allow.

### Explicitly NOT written in this feature
- **No integration/E2E test of the login page, server action, middleware chain, or placeholder role pages.** Setting up a headless browser, Next-dev harness, or React Server Components rendering test adds more scaffolding than the skeleton warrants. The two unit test files above cover the load-bearing logic (cookie codec + routing rules); the remaining wiring (form binding, cookie write in a real request, middleware redirecting a real request) is shallow glue that will get real coverage when feature `f` (admin CRUD) adds an E2E runner. This omission is intentional — re-evaluate when E2E infra lands.

## External services touched

- **Auth** — already wrapped by `interfaces/auth.ts`; this feature consumes the mock (`mocks/auth.ts`) exclusively. Real Supabase Auth adapter remains a `NotConfiguredError` stub until the `supabase-auth-real` feature wires it.

No new SMS, email, Anthropic, Mapbox, or Supabase clients introduced.

## Open questions

1. **Edge runtime import from `lib/session.ts`.** `middleware.ts` runs in Next's Edge runtime, which forbids `next/headers`. The plan imports `decodeSession` + `SESSION_COOKIE` from `lib/session.ts`, relying on the fact that those two symbols themselves do not touch `next/headers` (only `getSession`/`setSession`/`clearSession` do). If Next's bundler rejects this because the module as a whole pulls `cookies`, the fallback is to inline a 10–15 line decoder in `middleware.ts` and leave a comment linking to `lib/session.ts`. Builder should try the import first and fall back if `npm run build` complains. Not blocking — the decision is mechanical at build time.

2. **Driver display name.** Placeholder role pages render `Hello, driver {userId}` because storage has no user-profile lookup by `userId` yet (`storage.listDrivers()` returns driver records keyed by `profileId`, but there's no guaranteed join between the auth mock's `user-driver` user and a storage driver row). The real name will be hydrated from storage in feature `f`/`g`/`h`; this skeleton intentionally shows the bare userId so the wiring of role + session + rendering is visible. Not blocking.

3. **No `next=` redirect target allow-list beyond `evaluateAccess`.** The server action reuses `evaluateAccess` to validate the `next` target — a driver cannot trick the form into landing them on `/admin` by passing `?next=/admin`, because `evaluateAccess` would redirect them back to `/driver`. This is sufficient for v1. If Supabase Auth later introduces cross-subdomain redirects, this check will need to broaden. Flagging so it is not forgotten.
