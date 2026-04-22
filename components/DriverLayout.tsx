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
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto min-h-screen max-w-md bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <p className="text-base font-semibold">Lab Dispatch</p>
            <p className="text-xs text-gray-500">{driverName}</p>
          </div>
          <a
            href="/logout"
            className="inline-flex min-h-[44px] items-center rounded px-3 text-sm text-gray-700 hover:bg-gray-100"
          >
            Log out
          </a>
        </header>
        <main className="px-4 pb-8">
          {title ? (
            <h1 className="mb-4 mt-4 text-xl font-bold tracking-tight">
              {title}
            </h1>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
