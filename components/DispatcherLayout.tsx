import type { ReactNode } from "react";
import { DispatcherNavLink } from "./DispatcherNavLink";

interface DispatcherLayoutProps {
  title?: string;
  children: ReactNode;
}

/**
 * Two-column chrome for every /dispatcher/* page. Server component; the
 * highlight-active-link logic lives in the client-only
 * `DispatcherNavLink` child so this wrapper can stay server-side.
 */
export function DispatcherLayout({ title, children }: DispatcherLayoutProps) {
  return (
    <div className="app-shell flex min-h-screen flex-col lg:flex-row">
      <aside className="app-sidebar flex w-full flex-col lg:min-h-screen lg:w-64">
        <div className="px-5 py-5 lg:px-6 lg:py-7">
          <div className="brand-lockup brand-inverse">
            <span className="brand-mark brand-mark-small" aria-hidden="true" />
            <div>
              <p className="brand-title">Lab Dispatch</p>
              <p className="brand-subtitle">Dispatcher</p>
            </div>
          </div>
        </div>
        <nav className="flex flex-wrap gap-2 px-3 pb-3 lg:flex-1 lg:flex-nowrap lg:flex-col lg:px-4">
          <DispatcherNavLink href="/dispatcher">Dashboard</DispatcherNavLink>
          <DispatcherNavLink href="/dispatcher/requests">
            Requests
          </DispatcherNavLink>
          <DispatcherNavLink href="/dispatcher/routes">Routes</DispatcherNavLink>
          <DispatcherNavLink href="/dispatcher/map">Map</DispatcherNavLink>
          <DispatcherNavLink href="/dispatcher/messages">
            Messages
          </DispatcherNavLink>
        </nav>
        <div className="hidden p-4 lg:block">
          <div className="app-sidebar-panel p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
              Today
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              Live pickup board
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
            <p className="page-kicker">Dispatcher workspace</p>
            <h1 className="page-title mt-2">{title}</h1>
          </header>
        ) : null}
        {children}
      </main>
    </div>
  );
}
