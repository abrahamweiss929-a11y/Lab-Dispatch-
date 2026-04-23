import "server-only";
import { getSupabaseAdminClient } from "./supabase-client";
import type { AuthService, Session, SignInParams } from "./auth";
import type { UserRole } from "@/lib/types";

/**
 * Real Supabase-Auth-backed implementation of `AuthService`.
 *
 * Scope notes:
 *   - `signIn` validates the password via `auth.signInWithPassword`, then
 *     reads the caller's `profiles` row to resolve the app-level role.
 *     Every failure mode throws the single string `"invalid credentials"`
 *     so the login form renders the generic "Invalid email or password."
 *     banner and no DB / auth detail leaks to the user.
 *   - `signOut` is best-effort. The admin client holds no persistent user
 *     session, so the call is effectively a no-op on the server. The
 *     user-visible logout side-effect (clearing `ld_session`) lives in
 *     `app/logout/route.ts` via `clearSession()`.
 *   - `getCurrentUser` is intentionally scoped-throw today — no consumer
 *     reaches it. Every session resolver goes through
 *     `lib/session.ts::getSession()` reading the `ld_session` cookie.
 *     Wiring this properly requires the cookie rewire (STEP 4 in
 *     INTEGRATION_REPORT.md), which is a separate feature.
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
