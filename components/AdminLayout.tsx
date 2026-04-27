import type { ReactNode } from "react";
import { AdminNavLink } from "./AdminNavLink";

interface AdminLayoutProps {
  title?: string;
  children: ReactNode;
}

/**
 * Two-column chrome for every /admin/* page. As of the 2026-04-27
 * unification, /admin/* and /dispatcher/* are URL aliases for the
 * same office surface — the sidebar shows the full unified nav and
 * any back-office user (role 'office', plus legacy admin/dispatcher)
 * can reach every link.
 *
 * Server component; the highlight-active-link logic lives in the
 * client-only `AdminNavLink` child so this wrapper can stay
 * server-side.
 */
export function AdminLayout({ title, children }: AdminLayoutProps) {
  return (
    <div className="app-shell flex min-h-screen flex-col lg:flex-row">
      <aside className="app-sidebar flex w-full flex-col lg:min-h-screen lg:w-64">
        <div className="px-5 py-5 lg:px-6 lg:py-7">
          <div className="brand-lockup brand-inverse">
            <span className="brand-mark brand-mark-small" aria-hidden="true" />
            <div>
              <p className="brand-title">Lab Dispatch</p>
              <p className="brand-subtitle">Office</p>
            </div>
          </div>
        </div>
        <nav className="flex flex-wrap gap-2 px-3 pb-3 lg:flex-1 lg:flex-nowrap lg:flex-col lg:px-4">
          <AdminNavLink href="/dispatcher">Dashboard</AdminNavLink>
          <AdminNavLink href="/dispatcher/requests">Requests</AdminNavLink>
          <AdminNavLink href="/dispatcher/routes">Routes</AdminNavLink>
          <AdminNavLink href="/dispatcher/map">Map</AdminNavLink>
          <AdminNavLink href="/dispatcher/messages">Messages</AdminNavLink>
          <AdminNavLink href="/admin/drivers">Drivers</AdminNavLink>
          <AdminNavLink href="/admin/doctors">Doctors</AdminNavLink>
          <AdminNavLink href="/admin/offices">Offices</AdminNavLink>
          <AdminNavLink href="/admin/payroll">Payroll</AdminNavLink>
          <AdminNavLink href="/admin/users">Users</AdminNavLink>
        </nav>
        <div className="hidden p-4 lg:block">
          <div className="app-sidebar-panel p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
              Office
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              Pickups, drivers, access
            </p>
          </div>
        </div>
        <div className="border-t border-white/10 p-3 lg:p-4">
          <a
            href="/logout"
            className="app-nav-link min-h-[2.4rem] text-white/70"
          >
            Log out
          </a>
        </div>
      </aside>
      <main className="app-main px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {title ? (
          <header className="mb-6">
            <p className="page-kicker">Office workspace</p>
            <h1 className="page-title mt-2">{title}</h1>
          </header>
        ) : null}
        {children}
      </main>
    </div>
  );
}
