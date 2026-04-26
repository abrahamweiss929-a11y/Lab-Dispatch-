import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DriverLayout } from "@/components/DriverLayout";
import { GpsSampler } from "@/components/GpsSampler";
import { getServices } from "@/interfaces";
import { formatDateIsoToShort } from "@/lib/dates";
import { googleMapsRouteUrl } from "@/lib/google-maps-link";
import { requireDriverOrAdminSession } from "@/lib/require-driver";
import {
  buildRouteSummary,
  formatDriveSeconds,
  formatHourMinute,
} from "@/lib/route-summary";
import { getTodaysRouteForDriver } from "@/lib/today-route";
import type { Office, OfficeAddress, PickupRequest, Stop } from "@/lib/types";
import { CompleteRouteButton } from "../_components/CompleteRouteButton";
import { RouteSummaryCard } from "./_components/RouteSummaryCard";
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

  const [stops, requests, offices, locations] = await Promise.all([
    storage.listStops(route.id),
    storage.listPickupRequests(),
    storage.listOffices(),
    storage.listDriverLocations({ sinceMinutes: 30 }),
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

  const remainingStopViews = stopViews.filter((v) => !v.stop.pickedUpAt);
  const remainingWithCoords = remainingStopViews
    .map((v) =>
      v.office && typeof v.office.lat === "number" && typeof v.office.lng === "number"
        ? { lat: v.office.lat, lng: v.office.lng }
        : null,
    )
    .filter((p): p is { lat: number; lng: number } => p !== null);

  const driverLocation = locations.find((l) => l.driverId === driver.profileId);
  const origin =
    driverLocation && remainingWithCoords.length > 0
      ? { lat: driverLocation.lat, lng: driverLocation.lng }
      : remainingWithCoords[0];

  const summary =
    origin && remainingWithCoords.length > 0
      ? await buildRouteSummary(origin, remainingWithCoords)
      : null;

  // Map summary leg/eta arrays back to original stopViews indices.
  const stopMeta = new Map<string, { driveLabel?: string; etaLabel?: string }>();
  if (summary) {
    let idx = 0;
    for (const v of remainingStopViews) {
      const hasCoords =
        v.office &&
        typeof v.office.lat === "number" &&
        typeof v.office.lng === "number";
      if (!hasCoords) continue;
      const drive = summary.driveSecondsPerLeg[idx];
      const eta = summary.etaIsoPerStop[idx];
      stopMeta.set(v.stop.id, {
        driveLabel: drive !== undefined ? formatDriveSeconds(drive) : undefined,
        etaLabel: eta ? formatHourMinute(eta) : undefined,
      });
      idx++;
    }
  }

  const fullRouteUrl =
    remainingWithCoords.length > 0
      ? googleMapsRouteUrl(remainingWithCoords)
      : null;

  return (
    <DriverLayout title="Today's route" driverName={driver.fullName}>
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/driver"
          className="btn-link text-sm"
        >
          ← Back
        </Link>
        <div className="text-right text-xs text-gray-500">
          <p>{formatDateIsoToShort(route.routeDate)}</p>
          <p className="uppercase tracking-wide">{route.status}</p>
        </div>
      </div>

      {route.status === "pending" ? (
        <p className="empty-state text-sm">
          Route not started.{" "}
          <Link href="/driver" className="btn-link">
            Go back and tap &ldquo;Start route&rdquo;.
          </Link>
        </p>
      ) : (
        <>
          {summary && route.status === "active" ? (
            <RouteSummaryCard
              remainingStops={summary.remainingStops}
              driveMinutes={summary.driveMinutes}
              pickupMinutes={summary.pickupMinutes}
              finishLabel={formatHourMinute(summary.finishAtIso)}
              fromGoogle={summary.fromGoogle}
              fullRouteUrl={fullRouteUrl}
            />
          ) : null}

          {stopViews.length === 0 ? (
            <p className="empty-state text-sm">
              No stops on this route.
            </p>
          ) : (
            <ul className="space-y-3">
              {stopViews.map((v, idx) => {
                const meta = stopMeta.get(v.stop.id);
                return (
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
                      driveLabel={
                        v.stop.pickedUpAt ? undefined : meta?.driveLabel
                      }
                      etaLabel={v.stop.pickedUpAt ? undefined : meta?.etaLabel}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {allPickedUp &&
          session.role === "driver" &&
          route.status === "active" ? (
            <CompleteRouteButton routeId={route.id} />
          ) : null}

          {route.status === "completed" ? (
            <p className="alert-success mt-4 text-center text-sm">
              This route is already completed.
            </p>
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
