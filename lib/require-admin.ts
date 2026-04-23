import { redirect } from "next/navigation";
import { getSession, type SessionCookieValue } from "@/lib/session";

/**
 * Belt-and-suspenders admin gate for server components.
 *
 * The Edge middleware already denies non-admin traffic to `/admin/**`, but
 * pages call this anyway so a misconfigured matcher cannot silently leak
 * admin pages to dispatchers or drivers. On mismatch it triggers
 * `redirect("/login")`, which throws — callers can treat the return value
 * as non-null.
 */
export async function requireAdminSession(): Promise<SessionCookieValue> {
  const session = await getSession();
  if (session === null || session.role !== "admin") {
    redirect("/login");
  }
  return session;
}
