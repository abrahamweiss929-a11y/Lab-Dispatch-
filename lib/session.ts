/*
 * Dual-mode session helpers.
 *
 * Two cookie schemes live here, gated by `process.env.USE_MOCKS`:
 *
 *   - Mock mode (`USE_MOCKS=true` or unset):
 *     A single `ld_session` cookie encoding `{ userId, role }` as base64 JSON.
 *     The codec (`encodeSession` / `decodeSession`) lives in
 *     `lib/session-codec.ts` so the Edge middleware can import it without
 *     pulling in `next/headers`.
 *
 *   - Real mode (`USE_MOCKS=false`):
 *     Supabase Auth's own `sb-*` access/refresh cookies drive session state,
 *     written by `@supabase/ssr` in `lib/supabase-server.ts` /
 *     `lib/supabase-middleware.ts`. This module also writes a companion
 *     `ld_role` cookie so the Edge middleware can decide route access
 *     without a DB query. `getUserFromSession()` in `lib/supabase-server.ts`
 *     is the authoritative resolver; `ld_role` is a cache used only by the
 *     Edge fast path.
 *
 * `getSession`, `setSession`, and `clearSession` are `async` in both modes
 * because the real branch awaits a Supabase lookup. Every caller must
 * `await` them.
 *
 * Edge-runtime safety: this module imports `cookies()` from `next/headers`
 * and MUST NOT be imported by `middleware.ts` or anything else that runs
 * in the Edge runtime. Use `lib/session-codec.ts` there.
 */

import { cookies } from "next/headers";
import type { UserRole } from "@/lib/types";
import {
  SESSION_COOKIE,
  decodeSession,
  encodeSession,
  type SessionCookieValue,
} from "@/lib/session-codec";

export { SESSION_COOKIE, decodeSession, encodeSession };
export type { SessionCookieValue };

/**
 * Non-HTTPOnly? NO. This cookie is httpOnly=true. The Edge middleware
 * reads `request.cookies.get(...)` which CAN read httpOnly cookies, so
 * there is no need to expose this cookie to browser JS. Tampering
 * detection remains the job of `getUserFromSession()` on the server — a
 * forged `ld_role` gets through middleware but is rejected by every
 * server page's authoritative Supabase check.
 */
export const LD_ROLE_COOKIE = "ld_role";

function readUseMocks(): "mock" | "real" {
  const flag = process.env.USE_MOCKS;
  if (flag === undefined || flag === "true") return "mock";
  if (flag === "false") return "real";
  throw new Error(`USE_MOCKS must be 'true' or 'false', got: ${flag}`);
}

export async function getSession(): Promise<SessionCookieValue | null> {
  const mode = readUseMocks();
  if (mode === "mock") {
    const raw = cookies().get(SESSION_COOKIE)?.value;
    return decodeSession(raw);
  }
  // Real mode: defer to the Supabase-backed resolver. Import lazily so
  // the `server-only` + `@supabase/ssr` module graph is not pulled into
  // consumers that only need the codec (e.g. Edge middleware imports
  // `lib/session-codec.ts` directly and never loads this function).
  const { getUserFromSession } = await import("@/lib/supabase-server");
  return getUserFromSession();
}

export async function setSession(
  userId: string,
  role: UserRole,
): Promise<void> {
  const mode = readUseMocks();
  if (mode === "mock") {
    const value = encodeSession({ userId, role });
    cookies().set(SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    return;
  }
  // Real mode: Supabase's own `sb-*` cookies were written by
  // `auth.signInWithPassword` on the server client — we only set the
  // companion `ld_role` cookie so the Edge middleware has a fast-path
  // role signal without a DB query.
  // `userId` is intentionally unused here; the authoritative userId is
  // encoded in Supabase's signed JWT.
  void userId;
  cookies().set(LD_ROLE_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSession(): Promise<void> {
  const mode = readUseMocks();
  if (mode === "mock") {
    cookies().delete(SESSION_COOKIE);
    return;
  }
  // Real mode: Supabase's `sb-*` cookies are cleared by
  // `supabase.auth.signOut()` on the server client. We only clear the
  // companion `ld_role` cookie.
  cookies().delete(LD_ROLE_COOKIE);
}
