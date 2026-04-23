import "server-only";
import { getSupabaseAdminClient } from "./supabase-client";
import type { AuthService, Session, SignInParams } from "./auth";
import type { UserRole } from "@/lib/types";

/**
 * Real Supabase-Auth-backed implementation of `AuthService`.
 *
 * Status after the session-migration feature:
 *   - Real mode (USE_MOCKS=false): the methods on this service are
 *     effectively UNREACHABLE from application code. The real login /
 *     logout flows live in `app/login/actions.ts` and `app/logout/route.ts`
 *     and call `@supabase/ssr` directly via `lib/supabase-server.ts`
 *     (which is what actually writes the browser's `sb-*` cookies).
 *     This factory remains wired so `getServices()` under USE_MOCKS=false
 *     does not throw at construction time, but the interface is not
 *     exercised by the real code path. A follow-up to retire this
 *     interface entirely is flagged in BUILD_LOG.md (session-migration
 *     entry).
 *   - Mock mode (USE_MOCKS=true or unset): `authMock` (in `mocks/auth.ts`)
 *     implements the `AuthService` interface and IS reached by
 *     `app/login/actions.ts`'s mock branch. The three seeded mock
 *     accounts continue to work through it.
 *
 * Scope notes (legacy, kept for history):
 *   - `signIn` validates the password via `auth.signInWithPassword`, then
 *     reads the caller's `profiles` row to resolve the app-level role.
 *     Every failure mode throws the single string `"invalid credentials"`
 *     so the login form renders the generic "Invalid email or password."
 *     banner and no DB / auth detail leaks to the user.
 *   - `signOut` is best-effort on the admin client (which holds no
 *     persistent user session). User-visible logout happens in
 *     `app/logout/route.ts` via `clearSession()` + `supabase.auth.signOut()`
 *     on the `@supabase/ssr` server client.
 *   - `getCurrentUser` intentionally scoped-throws. No consumer reaches it
 *     after the session migration either: session reads flow through
 *     `lib/supabase-server.ts::getUserFromSession()` (real mode) or
 *     `lib/session.ts::getSession()` (mock mode).
 */

const INVALID = "invalid credentials";
const GET_CURRENT_USER_DEFERRED =
  "getCurrentUser on the real auth adapter requires the cookie migration (STEP 4 in INTEGRATION_REPORT.md)";

// Defensive enum guard against accidental `profiles.role` widening in a
// future migration — trust the DB, but verify.
const ALLOWED_ROLES: readonly UserRole[] = ["driver", "dispatcher", "admin"];

export function createRealAuthService(): AuthService {
  const sb = () => getSupabaseAdminClient();

  async function signIn(params: SignInParams): Promise<Session> {
    const signInResult = await sb().auth.signInWithPassword({
      email: params.email,
      password: params.password,
    });
    if (signInResult.error || !signInResult.data?.user) {
      throw new Error(INVALID);
    }
    const userId = signInResult.data.user.id;

    const profile = await sb()
      .from("profiles")
      .select("role, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (profile.error || !profile.data) {
      throw new Error(INVALID);
    }
    const rawRole = (profile.data as { role: string }).role;
    if (!ALLOWED_ROLES.includes(rawRole as UserRole)) {
      throw new Error(INVALID);
    }
    return { userId, role: rawRole as UserRole };
  }

  async function signOut(): Promise<void> {
    // The admin client holds no persistent user session, so this call is
    // effectively a no-op in practice. The user-visible logout
    // side-effect (clearing `ld_session`) happens in app/logout/route.ts
    // via `clearSession()`. When STEP 4 rewires to `sb-*` cookies, this
    // method's implementation (and the caller) will change.
    try {
      await sb().auth.signOut();
    } catch {
      // Never let signOut failure cascade into logout UX — logout must
      // always succeed from the user's perspective.
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
