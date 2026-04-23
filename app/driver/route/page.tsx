import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DriverLayout } from "@/components/DriverLayout";
import { GpsSampler } from "@/components/GpsSampler";
import { getServices } from "@/interfaces";
import { formatDateIsoToShort } from "@/lib/dates";
import { requireDriverOrAdminSession } from "@/lib/require-driver";
import { getTodaysRouteForDriver } from "@/lib/today-route";
import type { Office, OfficeAddress, PickupRequest, Stop } from "@/lib/types";
import { CompleteRouteButton } from "../_components/CompleteRouteButton";
import { StopCard, type StopCardStatus } from "./_components/StopCard";

function stopStatus(stop: Stop): StopCardStatus {
  if (stop.pickedUpAt) return "picked_up";
  if (stop.arrivedAt) return "arrived";
  return "pending";
}

interface StopView {
  stop: Stop;
  request?: PickupRequest;
  office?: Office;
  address?: OfficeAddress;
  officeName: string;
}

export default async function DriverRoutePage({
  searchParams,
}: {
  searchParams?: { driverId?: string };
}) {
  const session = await requireDriverOrAdminSession();
  const storage = getServices().storage;

  const driverId =
    session.role === "driver" ? session.userId : searchParams?.driverId;
  if (!driverId) {
    redirect("/driver");
  }

  const driver = await storage.getDriver(driverId);
  if (!driver) notFound();

  const route = await getTodaysRouteForDriver(driver.profileId);
  if (!route) {
    redirect("/driver");
  }

  const [stops, requests, offices] = await Promise.all([
    storage.listStops(route.id),
    storage.listPickupRequests(),
    storage.listOffices(),
  ]);

  const requestById = new Map(requests.map((r) => [r.id, r] as const));
  const officeById = new Map(offices.map((o) => [o.id, o] as const));

  const stopViews: StopView[] = stops.map((stop) => {
    const request = requestById.get(stop.pickupRequestId);
    const office = request?.officeId ? officeById.get(request.officeId) : undefined;
    return {
      stop,
      request,
      office,
      address: office?.address,
      officeName: office?.name ?? "Unknown office",
    };
  });

  const currentStopIndex = stopViews.findIndex(
    (v) => !v.stop.pickedUpAt,
  );

  const canCheckIn =
    session.role === "driver" && route.status === "active";
  const allPickedUp =
    stopViews.length > 0 && stopViews.every((v) => v.stop.pickedUpAt);
  const remaining = stopViews.filter((v) => !v.stop.pickedUpAt).length;

  return (
    <DriverLayout title="Today's route" driverName={driver.fullName}>
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/driver"
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back
        </Link>
        <div className="text-right text-xs text-gray-500">
          <p>{formatDateIsoToShort(route.routeDate)}</p>
          <p className="uppercase tracking-wide">{route.status}</p>
        </div>
      </div>

      {route.status === "pending" ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
          Route not started.{" "}
          <Link href="/driver" className="text-blue-600 hover:underline">
            Go back and tap &ldquo;Start route&rdquo;.
          </Link>
        </p>
      ) : (
        <>
          {stopViews.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
              No stops on this route.
            </p>
          ) : (
            <ul className="space-y-3">
              {stopViews.map((v, idx) => (
                <li key={v.stop.id}>
                  <StopCard
                    stopId={v.stop.id}
                    position={v.stop.position}
                    officeName={v.officeName}
                    address={v.address}
                    urgency={v.request?.urgency ?? "routine"}
                    sampleCount={v.request?.sampleCount}
                    specialInstructions={v.request?.specialInstructions}
                    status={stopStatus(v.stop)}
                    isCurrent={idx === currentStopIndex}
                    canCheckIn={canCheckIn}
                  />
                </li>
              ))}
            </ul>
          )}

          {allPickedUp && session.role === "driver" ? (
            <CompleteRouteButton routeId={route.id} />
          ) : null}

          {!allPickedUp && stopViews.length > 0 ? (
            <p className="mt-4 text-center text-sm text-gray-500">
              {remaining} stop{remaining === 1 ? "" : "s"} remaining
            </p>
          ) : null}

          {route.status === "active" ? (
            <p className="mt-6 text-center text-xs text-gray-400">
              Keep this page open to share your location.
            </p>
          ) : null}
        </>
      )}

      <GpsSampler
        routeId={route.id}
        enabled={route.status === "active" && session.role === "driver"}
      />
    </DriverLayout>
  );
}
