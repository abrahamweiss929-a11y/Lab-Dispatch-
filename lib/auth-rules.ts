import type { UserRole } from "@/lib/types";

export const PUBLIC_PATH_PREFIXES: readonly string[] = [
  "/login",
  "/logout",
  "/pickup/",
  "/invite/",
  "/api/",
  "/_next/",
  "/favicon",
];

/**
 * Single-source-of-truth roleset for back-office (non-driver) users.
 *
 * As of the 2026-04-27 unification, only `office` is granted to new users.
 * `admin` and `dispatcher` are kept in this list ONLY for backward
 * compatibility with any profile rows that haven't yet been migrated by
 * `supabase/migrations/2026-04-27-unify-office-role.sql`. After that
 * migration is applied, no production row uses `admin` or `dispatcher`.
 *
 * All three values grant identical access to both the `/admin/*` and
 * `/dispatcher/*` trees (which are aliases for the same surface).
 */
export const OFFICE_ROLES: readonly UserRole[] = [
  "office",
  "admin",
  "dispatcher",
];

export function isOfficeRole(role: UserRole | null): boolean {
  if (role === null) return false;
  return (OFFICE_ROLES as readonly string[]).includes(role);
}

export const PROTECTED_TREES: Record<UserRole, string> = {
  driver: "/driver",
  // Both `/dispatcher/*` and `/admin/*` are kept as routable URL trees;
  // every back-office role lands here. The /dispatcher entry point hosts
  // the unified day-to-day dashboard (Requests/Routes/Map/Messages on
  // top, with Drivers/Doctors/Offices/Payroll/Users in the same nav).
  dispatcher: "/dispatcher",
  admin: "/dispatcher",
  office: "/dispatcher",
};

export interface EvaluateAccessInput {
  pathname: string;
  role: UserRole | null;
}

export type AccessDecision =
  | { action: "allow" }
  | { action: "redirect"; to: string };

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/logout") return true;
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (prefix === "/login" || prefix === "/logout") continue;
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

export function landingPathFor(role: UserRole): string {
  return PROTECTED_TREES[role];
}

/**
 * Validates a post-login `next` redirect target.
 *
 * Returns true only for same-origin absolute paths. Rejects:
 *   - values that don't start with "/"
 *   - protocol-relative URLs ("//evil.com")
 *   - "/\evil.com" (browsers normalize "\" to "/", yielding "//evil.com")
 *   - any string containing a backslash, CR, LF, or NUL
 *
 * This is the only guard against open-redirect attacks in the sign-in flow;
 * callers must still run `evaluateAccess` against the path before honoring it.
 */
export function isSafeNext(next: string): boolean {
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  if (next.startsWith("/\\")) return false;
  if (/[\\\r\n\0]/.test(next)) return false;
  return true;
}

function isUnderTree(pathname: string, tree: string): boolean {
  return pathname === tree || pathname.startsWith(`${tree}/`);
}

export function evaluateAccess(input: EvaluateAccessInput): AccessDecision {
  const { pathname, role } = input;

  if (pathname === "/") return { action: "allow" };
  if (isPublicPath(pathname)) return { action: "allow" };

  const underDriver = isUnderTree(pathname, "/driver");
  const underDispatcher = isUnderTree(pathname, "/dispatcher");
  const underAdmin = isUnderTree(pathname, "/admin");

  if (!underDriver && !underDispatcher && !underAdmin) {
    return { action: "allow" };
  }

  if (role === null) {
    return {
      action: "redirect",
      to: `/login?next=${encodeURIComponent(pathname)}`,
    };
  }

  // Unified office surface: any back-office role can reach both
  // `/admin/*` and `/dispatcher/*`. They cannot reach `/driver/*` —
  // that's the driver's mobile-first UI.
  if (isOfficeRole(role)) {
    if (underDriver) return { action: "redirect", to: landingPathFor(role) };
    return { action: "allow" };
  }

  // role === "driver"
  if (underDriver) return { action: "allow" };
  return { action: "redirect", to: landingPathFor("driver") };
}
