import type { ReactNode } from "react";
import { AdminNavLink } from "./AdminNavLink";

interface AdminLayoutProps {
  title?: string;
  children: ReactNode;
}

/**
 * Two-column chrome for every /admin/* page. Server component; the
 * highlight-active-link logic lives in the client-only `AdminNavLink`
 * child so this wrapper can stay server-side.
 */
export function AdminLayout({ title, children }: AdminLayoutProps) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="flex w-52 flex-col border-r border-gray-200 bg-white">
        <div className="px-4 py-6">
          <p className="text-lg font-semibold">Lab Dispatch</p>
          <p className="text-xs text-gray-500">Admin</p>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          <AdminNavLink href="/admin">Dashboard</AdminNavLink>
          <AdminNavLink href="/admin/drivers">Drivers</AdminNavLink>
          <AdminNavLink href="/admin/doctors">Doctors</AdminNavLink>
          <AdminNavLink href="/admin/offices">Offices</AdminNavLink>
        </nav>
        <div className="border-t border-gray-200 p-2">
          <a
            href="/logout"
            className="block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            Log out
          </a>
        </div>
      </aside>
      <main className="flex-1 p-8">
        {title ? (
          <h1 className="mb-6 text-2xl font-bold tracking-tight">{title}</h1>
        ) : null}
        {children}
      </main>
    </div>
  );
}
