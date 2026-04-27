import Link from "next/link";
import { notFound } from "next/navigation";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { MapView, type MapPin } from "@/components/Map";
import { getServices } from "@/interfaces";
import { formatDateIsoToShort, todayIso } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import { AddStopForm } from "./_components/AddStopForm";
import { OptimizeOrderButton } from "./_components/OptimizeOrderButton";
import { RouteStatusControls } from "./_components/RouteStatusControls";
import { StopRow } from "./_components/StopRow";

function routeStatusBadgeClass(status: string): string {
  if (status === "completed") return "badge badge-success";
  if (status === "active") return "badge badge-info";
  return "badge badge-warning";
}

const STOP_COLORS = {
  picked_up: "#16a34a",
  arrived: "#eab308",
  pending: "#2563eb",
} as const;

export default async function RouteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireDispatcherSession();
  const storage = getServices().storage;
  const route = await storage.getRoute(params.id);
  if (!route) {
    notFound();
  }

  const [stops, allRequests, offices, drivers] = await Promise.all([
    storage.listStops(route.id),
    storage.listPickupRequests(),
    storage.listOffices(),
    storage.listDrivers(),
  ]);

  const officeById = new Map(offices.map((o) => [o.id, o] as const));
  const requestById = new Map(
    allRequests.map((r) => [r.id, r] as const),
  );
  const driverName =
    drivers.find((d) => d.profileId === route.driverId)?.fullName ??
    "Unknown driver";

  const today = todayIso();
  const pendingToday = allRequests
    .filter((r) => r.status === "pending")
    .filter((r) => r.createdAt.startsWith(today));

  const mapPins: MapPin[] = stops
    .map((stop): MapPin | null => {
      const req = requestById.get(stop.pickupRequestId);
      const office = req?.officeId ? officeById.get(req.officeId) : undefined;
      if (!office || office.lat === undefined || office.lng === undefined) {
        return null;
      }
      const status: keyof typeof STOP_COLORS = stop.pickedUpAt
        ? "picked_up"
        : stop.arrivedAt
          ? "arrived"
          : "pending";
      const addr = office.address;
      return {
        id: stop.id,
        lat: office.lat,
        lng: office.lng,
        label: String(stop.position),
        color: STOP_COLORS[status],
        popup: `${office.name}\n${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`,
      };
    })
    .filter((p): p is MapPin => p !== null);

  return (
    <DispatcherLayout title={`Route — ${driverName}`}>
      <div className="app-card mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <p>
            <span className="block text-xs font-bold uppercase text-[var(--muted)]">
              Driver
            </span>
            <span className="font-semibold">{driverName}</span>
          </p>
          <p>
            <span className="block text-xs font-bold uppercase text-[var(--muted)]">
              Date
            </span>
            <span className="font-semibold">
              {formatDateIsoToShort(route.routeDate)}
            </span>
          </p>
          <p>
            <span className="block text-xs font-bold uppercase text-[var(--muted)]">
              Status
            </span>
            <span className={routeStatusBadgeClass(route.status)}>
              {route.status}
            </span>
          </p>
        </div>
        <RouteStatusControls routeId={route.id} status={route.status} />
      </div>

      {mapPins.length > 0 ? (
        <div className="mb-6">
          <MapView pins={mapPins} showRoute height="400px" />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold">Stops</h2>
            {route.status !== "completed" && stops.length >= 3 ? (
              <OptimizeOrderButton routeId={route.id} />
            ) : null}
          </div>
          {stops.length === 0 ? (
            <p className="empty-state">
              No stops yet. Use the side pane to assign pending requests.
            </p>
          ) : (
            <div className="data-table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="px-4 py-2">#</th>
                    <th className="px-4 py-2">Office</th>
                    <th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {stops.map((stop, idx) => {
                    const req = requestById.get(stop.pickupRequestId);
                    const office = req?.officeId
                      ? officeById.get(req.officeId)
                      : undefined;
                    return (
                      <StopRow
                        key={stop.id}
                        routeId={route.id}
                        stopId={stop.id}
                        position={stop.position}
                        officeName={office?.name ?? "Unknown office"}
                        canMoveUp={idx > 0}
                        canMoveDown={idx < stops.length - 1}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside>
          <h2 className="mb-3 text-lg font-extrabold">Pending today</h2>
          {pendingToday.length === 0 ? (
            <p className="empty-state">
              Nothing pending today.
            </p>
          ) : (
            <ul className="space-y-2">
              {pendingToday.map((r) => {
                const office = r.officeId
                  ? officeById.get(r.officeId)
                  : undefined;
                const fromLabel = office
                  ? office.name
                  : r.sourceIdentifier && r.sourceIdentifier.length > 0
                    ? r.sourceIdentifier
                    : "Unknown";
                return (
                  <li
                    key={r.id}
                    className="app-card flex items-center justify-between gap-3 p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{fromLabel}</p>
                      <p className="text-xs text-gray-500">
                        {r.urgency} · {r.channel}
                      </p>
                    </div>
                    <AddStopForm routeId={route.id} pickupRequestId={r.id} />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 text-xs text-gray-500">
            <Link
              href="/dispatcher/requests"
              className="btn-link"
            >
              Full requests queue →
            </Link>
          </div>
        </aside>
      </div>
    </DispatcherLayout>
  );
}
