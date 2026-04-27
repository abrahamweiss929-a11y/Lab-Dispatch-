import { redirect } from "next/navigation";
import { isOfficeRole } from "@/lib/auth-rules";
import { getSession, type SessionCookieValue } from "@/lib/session";

/**
 * Belt-and-suspenders gate for `/admin/**` server components.
 *
 * As of the 2026-04-27 unification, `/admin/*` and `/dispatcher/*` are
 * URL aliases for the same office surface — every back-office role
 * (`office`, plus legacy `admin`/`dispatcher` for unmigrated rows) is
 * granted full access. Drivers and anonymous traffic are denied.
 *
 * The Edge middleware enforces the same rule via `evaluateAccess`; this
 * call exists so a misconfigured matcher cannot silently leak the page.
 */
export async function requireAdminSession(): Promise<SessionCookieValue> {
  const session = await getSession();
  if (session === null || !isOfficeRole(session.role)) {
    redirect("/login");
  }
  return session;
}
