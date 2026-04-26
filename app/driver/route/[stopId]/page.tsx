import Link from "next/link";
import { notFound } from "next/navigation";
import { DriverLayout } from "@/components/DriverLayout";
import { getServices } from "@/interfaces";
import { googleMapsSearchUrl } from "@/lib/office-links";
import { requireDriverOrAdminSession } from "@/lib/require-driver";
import type { PickupUrgency } from "@/lib/types";
import { StopCard, type StopCardStatus } from "../_components/StopCard";

const URGENCY_BADGE: Record<PickupUrgency, string> = {
  routine: "badge badge-neutral",
  urgent: "badge badge-warning",
  stat: "badge badge-danger",
};

export default async function StopDetailPage({
  params,
}: {
  params: { stopId: string };
}) {
  const session = await requireDriverOrAdminSession();
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
        className="btn-link mb-4 inline-block text-sm"
      >
        ← Back to route
      </Link>

      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full bg-gray-900 px-2 text-xs font-bold text-white">
          #{stop.position}
        </span>
        <span
          className={URGENCY_BADGE[request?.urgency ?? "routine"]}
        >
          {request?.urgency ?? "routine"}
        </span>
      </div>

      {office ? (
        <address className="app-card p-4 not-italic text-base text-gray-800">
          <p className="text-lg font-black text-[var(--brand-950)]">
            {office.address.street}
          </p>
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
          className="btn btn-secondary mt-3"
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
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
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
