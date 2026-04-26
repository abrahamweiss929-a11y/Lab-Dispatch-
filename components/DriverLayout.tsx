import type { ReactNode } from "react";

interface DriverLayoutProps {
  title?: string;
  driverName: string;
  children: ReactNode;
}

/**
 * Mobile-first single-column chrome for every `/driver/*` page.
 *
 * Server component. A compact header shows the lab wordmark, the current
 * driver's name, and a large-tap-target "Log out" link. The content area
 * sits inside a `max-w-md` shell centered on larger screens so desktop
 * smoke testing still looks reasonable.
 */
export function DriverLayout({ title, driverName, children }: DriverLayoutProps) {
  return (
    <div className="driver-shell min-h-screen px-3 py-3 sm:py-6">
      <div className="driver-phone mx-auto min-h-[calc(100vh-1.5rem)] max-w-md overflow-hidden rounded-lg border border-white/70 sm:min-h-[calc(100vh-3rem)]">
        <header className="driver-topbar px-4 pb-6 pt-4">
          <div className="flex items-center justify-between">
            <div className="brand-lockup brand-inverse">
              <span className="brand-mark brand-mark-small" aria-hidden="true" />
              <div>
                <p className="brand-title">Lab Dispatch</p>
                <p className="brand-subtitle">{driverName}</p>
              </div>
            </div>
            <a
              href="/logout"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white/78 hover:bg-white/15"
            >
              Log out
            </a>
          </div>
          {title ? (
            <div className="mt-8">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-100/70">
                Driver mobile
              </p>
              <h1 className="mt-2 text-3xl font-black leading-none text-white">
                {title}
              </h1>
            </div>
          ) : null}
        </header>
        <main className="-mt-3 px-4 pb-8">
          {children}
        </main>
      </div>
    </div>
  );
}
