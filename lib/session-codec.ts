/*
 * Edge-safe session codec.
 *
 * This module is pure: it never touches `next/headers`, `cookies()`, or any
 * Node/Server-only API. `middleware.ts` (which runs in the Edge runtime)
 * imports from here directly so it can decode the `ld_session` cookie in
 * mock mode without pulling `lib/session.ts`'s `cookies()`-dependent helpers
 * into the Edge bundle.
 *
 * `SESSION_COOKIE` is the mock-mode cookie name (base64 JSON). In real mode
 * (USE_MOCKS=false) the app instead uses Supabase Auth's `sb-*` cookies
 * plus the `ld_role` cookie defined in `lib/session.ts`.
 */

import type { UserRole } from "@/lib/types";

export const SESSION_COOKIE = "ld_session";

export interface SessionCookieValue {
  userId: string;
  role: UserRole;
}

const ALLOWED_ROLES: readonly UserRole[] = ["driver", "dispatcher", "admin"];

export function encodeSession(value: SessionCookieValue): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

export function decodeSession(raw: string | undefined): SessionCookieValue | null {
  if (!raw) return null;
  let jsonText: string;
  try {
    jsonText = Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Record<string, unknown>;
  const userId = candidate.userId;
  const role = candidate.role;
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (typeof role !== "string") return null;
  if (!ALLOWED_ROLES.includes(role as UserRole)) return null;
  return { userId, role: role as UserRole };
}

export function isAllowedRole(value: unknown): value is UserRole {
  return typeof value === "string" && ALLOWED_ROLES.includes(value as UserRole);
}
