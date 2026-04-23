import Link from "next/link";
import { DriverLayout } from "@/components/DriverLayout";
import { getServices } from "@/interfaces";
import {
  formatDateIsoToShort,
  formatShortDateTime,
  todayIso,
} from "@/lib/dates";
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
        <p className="rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          Admin view — no driver selected. Pick one from{" "}
          <Link
            href="/admin/drivers"
            className="text-blue-600 hover:underline"
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
        <p className="rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          Driver not found. <a className="text-blue-600" href="/logout">Log out</a>.
        </p>
      </DriverLayout>
    );
  }

  const route = await getTodaysRouteForDriver(driver.profileId);

  if (route === null) {
    return (
      <DriverLayout title="Today" driverName={driver.fullName}>
        <p className="text-xs uppercase tracking-wide text-gray-500">
          {formatDateIsoToShort(todayIso())}
        </p>
        <p className="mt-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
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
      <p className="text-xs uppercase tracking-wide text-gray-500">
        {formatDateIsoToShort(route.routeDate)}
      </p>
      <div className="mt-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Status</span>
          <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium uppercase tracking-wide text-gray-700">
            {route.status}
          </span>
        </div>
        <p className="mt-3 text-sm text-gray-700">
          Stops: {stopCount} · Completed: {completedCount}
        </p>
        {route.status === "completed" && route.completedAt ? (
          <p className="mt-2 text-xs text-gray-500">
            Completed {formatShortDateTime(route.completedAt)}
          </p>
        ) : null}
      </div>

      {route.status === "pending" ? (
        canStart ? (
          <StartRouteButton routeId={route.id} />
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">
            Admin view — drivers start routes
          </p>
        )
      ) : null}

      {route.status === "active" ? (
        <div className="mt-4 space-y-3">
          <Link
            href="/driver/route"
            className="block w-full rounded-xl bg-blue-600 py-4 text-center text-lg font-semibold text-white shadow hover:bg-blue-700"
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
