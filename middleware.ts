import { NextResponse, type NextRequest } from "next/server";
import { evaluateAccess } from "@/lib/auth-rules";
import { decodeSession, SESSION_COOKIE } from "@/lib/session-codec";
import {
  readSessionFromRequest,
  updateSession,
} from "@/lib/supabase-middleware";

/*
 * Dual-mode Edge middleware.
 *
 * Mock mode (USE_MOCKS unset or "true"):
 *   Read the `ld_session` base64-JSON cookie via the Edge-safe codec.
 *
 * Real mode (USE_MOCKS="false"):
 *   - Refresh Supabase cookies via `updateSession(request)` — the canonical
 *     `@supabase/ssr` recipe. The returned NextResponse carries the
 *     refreshed `sb-*` cookies; we re-use it when the access decision is
 *     "allow" so the browser receives them.
 *   - Read `{ userId, role }` from the request via `readSessionFromRequest`
 *     (fast-path, unsigned JWT). Every server page re-validates via
 *     `getUserFromSession()` which verifies against the Auth server.
 *
 * Any other USE_MOCKS value is treated as mock mode — middleware must not
 * throw in the Edge runtime since there's no sensible fallback UI.
 */

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const flag = process.env.USE_MOCKS;
  const realMode = flag === "false";

  if (!realMode) {
    const raw = request.cookies.get(SESSION_COOKIE)?.value;
    const session = decodeSession(raw);
    const decision = evaluateAccess({
      pathname: request.nextUrl.pathname,
      role: session?.role ?? null,
    });
    if (decision.action === "allow") {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL(decision.to, request.url));
  }

  // Real mode.
  const refreshedResponse = await updateSession(request);
  const session = await readSessionFromRequest(request);
  const decision = evaluateAccess({
    pathname: request.nextUrl.pathname,
    role: session?.role ?? null,
  });
  if (decision.action === "allow") {
    return refreshedResponse;
  }
  // On redirect, we lose the refreshed `sb-*` cookies for this hop.
  // That's acceptable: the redirect target re-runs middleware and
  // refreshes again.
  return NextResponse.redirect(new URL(decision.to, request.url));
}

export const config = {
  matcher: [
    // Run on everything except Next internals and obvious static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|txt|xml)).*)",
  ],
};
