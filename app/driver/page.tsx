import Link from "next/link";
import { DriverLayout } from "@/components/DriverLayout";
import { LocalDateTime } from "@/components/LocalDateTime";
import { getServices } from "@/interfaces";
import { formatDateIsoToShort, todayIso } from "@/lib/dates";
import { requireDriverOrAdminSession } from "@/lib/require-driver";
import { getTodaysRouteForDriver } from "@/lib/today-route";
import { StartRouteButton } from "./_components/StartRouteButton";
import { CompleteRouteButton } from "./_components/CompleteRouteButton";

export default async function DriverTodayPage({
  searchParams,
}: {
  searchParams?: { driverId?: string };
}) {
  const session = await requireDriverOrAdminSession();
  const storage = getServices().storage;

  let driverId: string | undefined;
  if (session.role === "driver") {
    driverId = session.userId;
  } else {
    // admin debug-view: needs ?driverId=...
    driverId = searchParams?.driverId;
  }

  if (!driverId) {
    return (
      <DriverLayout title="Driver view" driverName="Admin">
        <p className="empty-state">
          Admin view — no driver selected. Pick one from{" "}
          <Link
            href="/admin/drivers"
            className="btn-link"
          >
            Admin → Drivers
          </Link>
          .
        </p>
      </DriverLayout>
    );
  }

  const driver = await storage.getDriver(driverId);
  if (!driver) {
    return (
      <DriverLayout title="Today" driverName="Unknown">
        <p className="empty-state">
          Driver not found. <a className="btn-link" href="/logout">Log out</a>.
        </p>
      </DriverLayout>
    );
  }

  const route = await getTodaysRouteForDriver(driver.profileId);

  if (route === null) {
    return (
      <DriverLayout title="Today" driverName={driver.fullName}>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand-700)]">
          {formatDateIsoToShort(todayIso())}
        </p>
        <p className="empty-state mt-3">
          No route assigned yet — check with your dispatcher.
        </p>
      </DriverLayout>
    );
  }

  const stops = await storage.listStops(route.id);
  const stopCount = stops.length;
  const completedCount = stops.filter((s) => s.pickedUpAt).length;
  const canStart = session.role === "driver";

  return (
    <DriverLayout title="Today" driverName={driver.fullName}>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand-700)]">
        {formatDateIsoToShort(route.routeDate)}
      </p>
      <div className="app-card mt-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-700">Status</span>
          <span className="badge badge-info">
            {route.status}
          </span>
        </div>
        <p className="mt-4 text-3xl font-black text-[var(--brand-950)]">
          {completedCount}/{stopCount}
        </p>
        <p className="mt-1 text-sm text-gray-600">
          stops completed
        </p>
        {route.status === "completed" && route.completedAt ? (
          <p className="mt-2 text-xs text-gray-500">
            Completed <LocalDateTime iso={route.completedAt} />
          </p>
        ) : null}
      </div>

      {route.status === "pending" ? (
        canStart ? (
          <StartRouteButton routeId={route.id} />
        ) : (
          <p className="empty-state mt-4 text-center">
            Admin view — drivers start routes
          </p>
        )
      ) : null}

      {route.status === "active" ? (
        <div className="mt-4 space-y-3">
          <Link
            href="/driver/route"
            className="mobile-action"
          >
            Open route
          </Link>
          {canStart ? (
            <CompleteRouteButton
              routeId={route.id}
              disabled={completedCount < stopCount}
            />
          ) : null}
        </div>
      ) : null}
    </DriverLayout>
  );
}
