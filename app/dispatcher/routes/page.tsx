import Link from "next/link";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { formatDateIsoToShort, todayIso } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import type { RouteStatus } from "@/lib/types";

const STATUS_TABS: Array<{ value: "all" | RouteStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

type StatusTab = "all" | RouteStatus;

function parseStatus(raw?: string): StatusTab {
  if (raw === "pending" || raw === "active" || raw === "completed") {
    return raw;
  }
  return "all";
}

export default async function DispatcherRoutesPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  await requireDispatcherSession();
  const status = parseStatus(searchParams?.status);
  const today = todayIso();
  const storage = getServices().storage;
  const [routes, drivers] = await Promise.all([
    storage.listRoutes({
      date: today,
      status: status === "all" ? undefined : status,
    }),
    storage.listDrivers(),
  ]);
  const driverNameById = new Map(
    drivers.map((d) => [d.profileId, d.fullName] as const),
  );

  // N+1 here is acceptable at v1 scale (dozens of routes per day). The
  // real Supabase adapter will collapse this into a single aggregate
  // query.
  const stopCounts = await Promise.all(
    routes.map((r) => storage.listStops(r.id).then((s) => s.length)),
  );

  return (
    <DispatcherLayout title="Routes">
      <div className="mb-4 flex items-center justify-between">
        <nav className="flex gap-1 rounded bg-gray-100 p-1 text-sm">
          {STATUS_TABS.map((tab) => {
            const active = tab.value === status;
            return (
              <Link
                key={tab.value}
                href={
                  tab.value === "all"
                    ? "/dispatcher/routes"
                    : `/dispatcher/routes?status=${tab.value}`
                }
                className={
                  active
                    ? "rounded bg-white px-3 py-1 font-medium shadow-sm"
                    : "rounded px-3 py-1 text-gray-600 hover:bg-white"
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/dispatcher/routes/new"
          className="rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New route
        </Link>
      </div>

      {routes.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          No routes for today in this view.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Driver</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Stops</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {routes.map((r, idx) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-medium">
                    {driverNameById.get(r.driverId) ?? "Unknown driver"}
                  </td>
                  <td className="px-4 py-2">
                    {formatDateIsoToShort(r.routeDate)}
                  </td>
                  <td className="px-4 py-2">{stopCounts[idx]}</td>
                  <td className="px-4 py-2">{r.status}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/dispatcher/routes/${r.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DispatcherLayout>
  );
}
