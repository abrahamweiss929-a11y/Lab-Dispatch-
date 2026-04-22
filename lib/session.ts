/*
 * Mock-grade session cookie helper.
 *
 * This module encodes the current session as a base64-JSON `ld_session`
 * cookie. It is explicitly a stop-gap: when Supabase Auth wiring lands,
 * Supabase's own sb-* access/refresh cookies will replace `ld_session` and
 * this file will be rewritten or removed. See BLOCKERS.md [supabase] for the
 * migration note.
 *
 * Edge-runtime safety: `encodeSession` and `decodeSession` are pure and do
 * not touch `next/headers`, so they can be imported from `middleware.ts`
 * which runs in the Edge runtime. `getSession`/`setSession`/`clearSession`
 * DO import `cookies` from `next/headers` and MUST NOT be called from Edge.
 */

import { cookies } from "next/headers";
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

export function getSession(): SessionCookieValue | null {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  return decodeSession(raw);
}

export function setSession(userId: string, role: UserRole): void {
  const value = encodeSession({ userId, role });
  cookies().set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearSession(): void {
  cookies().delete(SESSION_COOKIE);
}
