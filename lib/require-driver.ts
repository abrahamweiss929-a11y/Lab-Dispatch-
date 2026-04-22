import { redirect } from "next/navigation";
import { getSession, type SessionCookieValue } from "@/lib/session";

/**
 * Strict driver-only gate for server actions under `/driver/**`. Admins
 * can view driver pages for debugging (see `requireDriverOrAdminSession`),
 * but no admin session may issue a driver check-in or GPS ping — those
 * rows are the driver's audit trail, not the admin's.
 *
 * Behavior: on mismatch, triggers `redirect("/login")`, which throws —
 * callers can treat the return value as non-null.
 */
export function requireDriverSession(): SessionCookieValue {
  const session = getSession();
  if (session === null || session.role !== "driver") {
    redirect("/login");
  }
  return session;
}

/**
 * Relaxed driver-or-admin gate for read-only page components under
 * `/driver/**`. Admins can debug-view any driver's screens (the middleware
 * already permits admin everywhere); dispatchers and anonymous users are
 * bounced to `/login`.
 */
export function requireDriverOrAdminSession(): SessionCookieValue {
  const session = getSession();
  if (
    session === null ||
    (session.role !== "driver" && session.role !== "admin")
  ) {
    redirect("/login");
  }
  return session;
}
