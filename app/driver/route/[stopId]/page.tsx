import Link from "next/link";
import { notFound } from "next/navigation";
import { DriverLayout } from "@/components/DriverLayout";
import { getServices } from "@/interfaces";
import { googleMapsSearchUrl } from "@/lib/office-links";
import { requireDriverOrAdminSession } from "@/lib/require-driver";
import type { PickupUrgency } from "@/lib/types";
import { StopCard, type StopCardStatus } from "../_components/StopCard";

const URGENCY_BADGE: Record<PickupUrgency, string> = {
  routine: "bg-gray-100 text-gray-700",
  urgent: "bg-amber-100 text-amber-800",
  stat: "bg-red-100 text-red-800",
};

export default async function StopDetailPage({
  params,
}: {
  params: { stopId: string };
}) {
  const session = requireDriverOrAdminSession();
  const storage = getServices().storage;

  const stop = await storage.getStop(params.stopId);
  if (!stop) notFound();

  const route = await storage.getRoute(stop.routeId);
  if (!route) notFound();
  if (session.role === "driver" && route.driverId !== session.userId) {
    notFound();
  }

  const driver = await storage.getDriver(route.driverId);
  if (!driver) notFound();

  const requests = await storage.listPickupRequests();
  const request = requests.find((r) => r.id === stop.pickupRequestId);
  const office = request?.officeId
    ? await storage.getOffice(request.officeId)
    : null;

  const status: StopCardStatus = stop.pickedUpAt
    ? "picked_up"
    : stop.arrivedAt
      ? "arrived"
      : "pending";
  const canCheckIn =
    session.role === "driver" && route.status === "active";

  return (
    <DriverLayout
      title={office?.name ?? "Stop"}
      driverName={driver.fullName}
    >
      <Link
        href="/driver/route"
        className="mb-4 inline-block text-sm text-blue-600 hover:underline"
      >
        ← Back to route
      </Link>

      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full bg-gray-900 px-2 text-xs font-bold text-white">
          #{stop.position}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${URGENCY_BADGE[request?.urgency ?? "routine"]}`}
        >
          {request?.urgency ?? "routine"}
        </span>
      </div>

      {office ? (
        <address className="not-italic text-base text-gray-800">
          <p className="text-lg font-medium">{office.address.street}</p>
          <p>
            {office.address.city}, {office.address.state} {office.address.zip}
          </p>
        </address>
      ) : (
        <p className="text-sm text-gray-500">Address unavailable.</p>
      )}

      {office ? (
        <a
          href={googleMapsSearchUrl(office.address)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-100"
        >
          Open in Maps
        </a>
      ) : null}

      {typeof request?.sampleCount === "number" ? (
        <p className="mt-4 text-base">
          <span className="font-medium">Samples:</span> {request.sampleCount}
        </p>
      ) : null}

      {request?.specialInstructions &&
      request.specialInstructions.length > 0 ? (
        <div className="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Special instructions</p>
          <p className="mt-1">{request.specialInstructions}</p>
        </div>
      ) : null}

      <div className="mt-6">
        <StopCard
          stopId={stop.id}
          position={stop.position}
          officeName={office?.name ?? "Stop"}
          address={office?.address}
          urgency={request?.urgency ?? "routine"}
          sampleCount={request?.sampleCount}
          specialInstructions={request?.specialInstructions}
          status={status}
          isCurrent
          canCheckIn={canCheckIn}
        />
      </div>

      <p className="mt-6 text-center text-xs text-gray-400">
        Map coming soon — use &ldquo;Open in Maps&rdquo; to navigate.
      </p>
    </DriverLayout>
  );
}
