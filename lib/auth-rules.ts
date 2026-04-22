import type { UserRole } from "@/lib/types";

export const PUBLIC_PATH_PREFIXES: readonly string[] = [
  "/login",
  "/logout",
  "/pickup/",
  "/api/",
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

  const underDriver = isUnderTree(pathname, PROTECTED_TREES.driver);
  const underDispatcher = isUnderTree(pathname, PROTECTED_TREES.dispatcher);
  const underAdmin = isUnderTree(pathname, PROTECTED_TREES.admin);

  if (!underDriver && !underDispatcher && !underAdmin) {
    return { action: "allow" };
  }

  if (role === null) {
    return {
      action: "redirect",
      to: `/login?next=${encodeURIComponent(pathname)}`,
    };
  }

  if (role === "admin") {
    return { action: "allow" };
  }

  if (role === "dispatcher") {
    if (underDispatcher) return { action: "allow" };
    return { action: "redirect", to: landingPathFor("dispatcher") };
  }

  // role === "driver"
  if (underDriver) return { action: "allow" };
  return { action: "redirect", to: landingPathFor("driver") };
}
