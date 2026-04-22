import Link from "next/link";
import { notFound } from "next/navigation";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { formatDateIsoToShort, todayIso } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import { AddStopForm } from "./_components/AddStopForm";
import { RouteStatusControls } from "./_components/RouteStatusControls";
import { StopRow } from "./_components/StopRow";

export default async function RouteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  requireDispatcherSession();
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

  return (
    <DispatcherLayout title={`Route — ${driverName}`}>
      <div className="mb-6 flex items-center justify-between rounded border border-gray-200 bg-white p-4">
        <div className="space-y-1 text-sm">
          <p>
            <span className="font-medium">Driver:</span> {driverName}
          </p>
          <p>
            <span className="font-medium">Date:</span>{" "}
            {formatDateIsoToShort(route.routeDate)}
          </p>
          <p>
            <span className="font-medium">Status:</span> {route.status}
          </p>
        </div>
        <RouteStatusControls routeId={route.id} status={route.status} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Stops</h2>
          {stops.length === 0 ? (
            <p className="rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
              No stops yet. Use the side pane to assign pending requests.
            </p>
          ) : (
            <div className="overflow-hidden rounded border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
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
          <h2 className="mb-3 text-lg font-semibold">Pending today</h2>
          {pendingToday.length === 0 ? (
            <p className="rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
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
                    className="flex items-center justify-between rounded border border-gray-200 bg-white p-3 text-sm"
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
              className="text-blue-600 hover:underline"
            >
              Full requests queue →
            </Link>
          </div>
        </aside>
      </div>
    </DispatcherLayout>
  );
}
