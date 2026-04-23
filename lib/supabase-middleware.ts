/*
 * Edge-runtime-safe helpers for the real-mode middleware path.
 *
 * NOT marked `"server-only"` because this module runs inside
 * `middleware.ts`, which is an Edge runtime — neither Node nor a pure
 * Server Component. Must not import from `next/headers`, must not touch
 * Node-only APIs. `@supabase/ssr`'s `createServerClient` is Edge-safe.
 *
 * Two exports:
 *   - `updateSession(request)` — the canonical `@supabase/ssr` middleware
 *     helper. Constructs a server client whose cookie adapters read from
 *     `request.cookies` and write to BOTH `request.cookies` (so downstream
 *     code within this request sees the refreshed values) and the response
 *     (so the browser stores them). Calls `supabase.auth.getUser()` once
 *     to trigger a token refresh if needed. Returns the response with
 *     refreshed cookies.
 *   - `readSessionFromRequest(request)` — a fast-path heuristic used by
 *     middleware to decide route access WITHOUT a DB query. Reads the
 *     `ld_role` companion cookie and the Supabase access-token cookie,
 *     pulls `sub` out of the JWT payload (unsigned — the signature is
 *     NOT verified here), returns `{ userId, role } | null`. Every
 *     server page re-checks authoritatively via `getUserFromSession()`.
 *     A forged cookie pair passes this function but is rejected by the
 *     server-side resolver on the next page render.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LD_ROLE_COOKIE } from "@/lib/session";
import { isAllowedRole, type SessionCookieValue } from "@/lib/session-codec";

const SB_ACCESS_TOKEN_COOKIE_PATTERN = /^sb-.+-auth-token(\.\d+)?$/;

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Without credentials, we can't refresh — return the pass-through
    // response. `readSessionFromRequest` will yield null, and the
    // middleware caller will redirect protected routes to /login.
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map((c) => ({
          name: c.name,
          value: c.value,
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          // Dual-write: request for downstream code within this
          // request, response for the browser. This is the canonical
          // @supabase/ssr middleware pattern.
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next();
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Trigger the refresh. Per `@supabase/ssr`'s docs this must be called
  // exactly once before any response is committed, and must be
  // `getUser()` (not `getSession()`) so the token is verified against
  // the Auth server.
  await supabase.auth.getUser();

  return supabaseResponse;
}

interface JwtPayload {
  sub?: unknown;
}

function base64UrlDecode(segment: string): string | null {
  // Convert base64url to base64, pad, then decode.
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    normalized.length % 4 === 0
      ? normalized
      : normalized + "=".repeat(4 - (normalized.length % 4));
  try {
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function parseJwtSubUnsafe(jwt: string): string | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  const payloadRaw = parts[1];
  if (!payloadRaw) return null;
  const decoded = base64UrlDecode(payloadRaw);
  if (decoded === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const sub = (parsed as JwtPayload).sub;
  if (typeof sub !== "string" || sub.length === 0) return null;
  return sub;
}

/**
 * Locates the Supabase access token in the request cookies. `@supabase/ssr`
 * writes the token under `sb-<project-ref>-auth-token` (optionally split
 * into `.0`, `.1`, … chunks when the value is large). Some versions
 * JSON-encode the cookie value as `["<access_token>","<refresh_token>"]`;
 * others store a bare JWT. We handle both by returning the first value
 * that looks like a JWT (three dot-separated segments).
 */
function findAccessTokenJwt(request: NextRequest): string | null {
  // Sort by name so chunked cookies (`.0`, `.1`, ...) assemble in order —
  // request.cookies.getAll() doesn't guarantee ordering.
  const matching = request.cookies
    .getAll()
    .filter((c) => SB_ACCESS_TOKEN_COOKIE_PATTERN.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (matching.length === 0) return null;
  const joined = matching.map((c) => c.value).join("");

  // @supabase/ssr v0.5+ writes the cookie as `base64-<b64>` where the
  // decoded bytes are the JSON session object. Older versions stored the
  // JSON directly or (rarer still) a bare JWT. Handle all three.
  let payload = joined;
  if (payload.startsWith("base64-")) {
    const b64 = payload.slice("base64-".length);
    const decoded = base64UrlDecode(b64);
    if (decoded === null) return null;
    payload = decoded;
  }

  const candidates: string[] = [];
  try {
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed) && typeof parsed[0] === "string") {
      candidates.push(parsed[0]);
    } else if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { access_token?: unknown }).access_token === "string"
    ) {
      candidates.push((parsed as { access_token: string }).access_token);
    }
  } catch {
    // Not JSON — fall through to "treat as a bare JWT".
  }
  candidates.push(payload);

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.split(".").length >= 2) {
      return candidate;
    }
  }
  return null;
}

/**
 * Edge fast-path session read. NOT authoritative — every protected
 * server page calls `getUserFromSession()` (in `lib/supabase-server.ts`)
 * which contacts the Supabase Auth server to verify the JWT signature.
 * This function only parses the payload to get a `sub` claim for
 * middleware's coarse allow/deny decision.
 */
export async function readSessionFromRequest(
  request: NextRequest,
): Promise<SessionCookieValue | null> {
  const roleRaw = request.cookies.get(LD_ROLE_COOKIE)?.value;
  if (!roleRaw || !isAllowedRole(roleRaw)) return null;

  const jwt = findAccessTokenJwt(request);
  if (jwt === null) return null;

  const sub = parseJwtSubUnsafe(jwt);
  if (sub === null) return null;

  return { userId: sub, role: roleRaw };
}
