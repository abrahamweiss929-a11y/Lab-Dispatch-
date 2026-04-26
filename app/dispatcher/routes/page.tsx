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

function routeStatusBadgeClass(status: RouteStatus): string {
  if (status === "completed") return "badge badge-success";
  if (status === "active") return "badge badge-info";
  return "badge badge-warning";
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
      <div className="toolbar">
        <nav className="segmented-nav">
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
                    ? "segmented-link segmented-link-active"
                    : "segmented-link"
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/dispatcher/routes/new"
          className="btn btn-primary"
        >
          New route
        </Link>
      </div>

      {routes.length === 0 ? (
        <p className="empty-state">
          No routes for today in this view.
        </p>
      ) : (
        <div className="data-table-shell">
          <table className="data-table">
            <thead>
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
                  <td className="px-4 py-2">
                    <span className={routeStatusBadgeClass(r.status)}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/dispatcher/routes/${r.id}`}
                      className="btn-link"
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
