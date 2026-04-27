import Link from "next/link";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { formatShortDateTime } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";

export default async function DispatcherMapPage() {
  await requireDispatcherSession();
  const storage = getServices().storage;
  const [locations, drivers] = await Promise.all([
    storage.listDriverLocations({ sinceMinutes: 15 }),
    storage.listDrivers(),
  ]);

  const driverById = new Map(drivers.map((d) => [d.profileId, d] as const));
  const reportingDriverIds = new Set(locations.map((loc) => loc.driverId));
  const notReporting = drivers.filter(
    (d) => d.active && !reportingDriverIds.has(d.profileId),
  );

  return (
    <DispatcherLayout title="Driver map">
      <section className="map-panel mb-6">
        <span className="map-pin map-pin-one" aria-hidden="true" />
        <span className="map-pin map-pin-two" aria-hidden="true" />
        <span className="map-pin map-pin-three" aria-hidden="true" />
        <div className="relative z-10 max-w-md p-5">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--brand-700)]">
            Live location snapshot
          </p>
          <h2 className="mt-2 text-2xl font-black text-[var(--brand-950)]">
            Driver pings from the last 15 minutes.
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            This becomes a real Mapbox view when{" "}
            <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> is wired. For now, the table
            below keeps the same operational data visible.
          </p>
        </div>
      </section>

      {locations.length === 0 ? (
        <p className="empty-state">
          No recent driver pings.
        </p>
      ) : (
        <div className="data-table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-4 py-2">Driver</th>
                <th className="px-4 py-2">Recorded at</th>
                <th className="px-4 py-2">Lat</th>
                <th className="px-4 py-2">Lng</th>
                <th className="px-4 py-2">On route?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {locations.map((loc) => {
                const driver = driverById.get(loc.driverId);
                return (
                  <tr key={loc.id}>
                    <td className="px-4 py-2 font-medium">
                      {driver?.fullName ?? "Unknown driver"}
                    </td>
                    <td className="px-4 py-2">
                      {formatShortDateTime(loc.recordedAt)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {loc.lat.toFixed(6)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {loc.lng.toFixed(6)}
                    </td>
                    <td className="px-4 py-2">
                      {loc.routeId ? (
                        <Link
                          href={`/dispatcher/routes/${loc.routeId}`}
                          className="btn-link"
                        >
                          Yes
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {notReporting.length > 0 ? (
        <section className="app-card mt-6 p-4">
          <h2 className="mb-2 text-sm font-extrabold text-[var(--brand-900)]">
            Not reporting
          </h2>
          <ul className="space-y-1 text-sm text-gray-500">
            {notReporting.map((d) => (
              <li key={d.profileId}>{d.fullName}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </DispatcherLayout>
  );
}
