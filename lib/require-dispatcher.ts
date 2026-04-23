import { redirect } from "next/navigation";
import { getSession, type SessionCookieValue } from "@/lib/session";

/**
 * Belt-and-suspenders dispatcher gate for server components and server
 * actions under `/dispatcher/**`.
 *
 * The Edge middleware already denies non-(dispatcher|admin) traffic to
 * `/dispatcher/**`, but pages and actions call this anyway so a
 * misconfigured matcher cannot silently leak dispatcher pages to drivers
 * or anonymous traffic. On mismatch it triggers `redirect("/login")`,
 * which throws — callers can treat the return value as non-null.
 *
 * Admins are permitted because `evaluateAccess` already treats them as
 * allowed anywhere (they cover dispatch in emergencies and for dev
 * smoke).
 */
export async function requireDispatcherSession(): Promise<SessionCookieValue> {
  const session = await getSession();
  if (
    session === null ||
    (session.role !== "dispatcher" && session.role !== "admin")
  ) {
    redirect("/login");
  }
  return session;
}
