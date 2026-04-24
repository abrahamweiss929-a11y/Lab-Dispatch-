import Link from "next/link";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { MapView, type MapPin } from "@/components/Map";
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

  const mapPins: MapPin[] = locations.map((loc) => {
    const driver = driverById.get(loc.driverId);
    const name = driver?.fullName ?? "Unknown driver";
    return {
      id: loc.id,
      lat: loc.lat,
      lng: loc.lng,
      color: "#16a34a",
      popup: `${name}\nLast ping ${formatShortDateTime(loc.recordedAt)}`,
    };
  });

  return (
    <DispatcherLayout title="Driver map">
      <div className="mb-6">
        <MapView pins={mapPins} height="420px" autoRefreshMs={30_000} />
      </div>

      {locations.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          No recent driver pings.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
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
                          className="text-blue-600 hover:underline"
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
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">
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
