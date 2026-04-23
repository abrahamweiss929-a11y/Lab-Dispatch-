import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NotConfiguredError } from "@/lib/errors";
import { getSupabaseAdminClient } from "@/interfaces/supabase-client";
import { isAllowedRole, type SessionCookieValue } from "@/lib/session-codec";

/**
 * User-session Supabase client wired to Next.js App Router cookies.
 *
 * Uses the anon key + `@supabase/ssr`'s `createServerClient` — distinct
 * from the service-role admin client in `interfaces/supabase-client.ts`.
 * Writes are session-scoped. This client is the one that issues
 * `auth.signInWithPassword`, reads `auth.getUser()`, and calls
 * `auth.signOut()` for the real login/logout flows.
 *
 * Uses the `getAll` / `setAll` cookie API (0.5+) as recommended by
 * `@supabase/ssr`; the deprecated `get/set/remove` API misses edge cases.
 */
export function createSupabaseServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || url.length === 0) {
    throw new NotConfiguredError({
      service: "auth (Supabase)",
      envVar: "NEXT_PUBLIC_SUPABASE_URL",
    });
  }
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey || anonKey.length === 0) {
    throw new NotConfiguredError({
      service: "auth (Supabase)",
      envVar: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    });
  }

  const cookieStore = cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll().map((c) => ({
          name: c.name,
          value: c.value,
        }));
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set({ name, value, ...options });
          }
        } catch {
          // `cookies().set` throws from a Server Component. Swallow:
          // middleware (`lib/supabase-middleware.ts::updateSession`) is
          // the one that refreshes cookies on every request, so Server
          // Component renders can safely ignore write failures here.
        }
      },
    },
  });
}

/**
 * Authoritative session resolver for real mode.
 *
 * Calls `supabase.auth.getUser()` (which contacts the Supabase Auth
 * server to verify the access token — do NOT replace with `getSession()`
 * which trusts the cookie without validation), then looks up the
 * profile's `role` via the service-role admin client (bypassing RLS so
 * this works regardless of policy state).
 *
 * Returns null on any failure path: missing user, missing profile row,
 * unknown role value, or Supabase error. Never throws to the caller —
 * an unauthenticated state is represented as `null`.
 */
export async function getUserFromSession(): Promise<SessionCookieValue | null> {
  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseServerClient();
  } catch {
    // Configuration error is surfaced by callers that explicitly need
    // the client; for session-reads we degrade to "no session" so page
    // renders don't crash with a 500 when env is unset. This matches the
    // mock-mode contract where "no cookie" returns null.
    return null;
  }

  const userResp = await supabase.auth.getUser();
  if (userResp.error || !userResp.data.user) {
    return null;
  }
  const userId = userResp.data.user.id;
  if (typeof userId !== "string" || userId.length === 0) return null;

  const admin = getSupabaseAdminClient();
  const profile = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (profile.error || !profile.data) {
    return null;
  }
  const rawRole = (profile.data as { role?: unknown }).role;
  if (!isAllowedRole(rawRole)) return null;
  return { userId, role: rawRole };
}
