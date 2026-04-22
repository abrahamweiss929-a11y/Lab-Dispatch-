import { getServices } from "@/interfaces";
import { todayIso } from "@/lib/dates";
import type { Route } from "@/lib/types";

/**
 * Returns the single route assigned to `driverId` for today, or `null` if
 * the driver has no route today.
 *
 * The schema enforces `unique (driver_id, route_date)` via
 * `routes_driver_id_route_date_key` so in production there is at most one
 * row. The mock doesn't enforce it; if multiple match we return the
 * earliest-created (by `listRoutes` sort order) as a defensive choice.
 */
export async function getTodaysRouteForDriver(
  driverId: string,
  timeZone: string = "UTC",
): Promise<Route | null> {
  const date = todayIso(timeZone);
  const routes = await getServices().storage.listRoutes({ driverId, date });
  return routes[0] ?? null;
}
