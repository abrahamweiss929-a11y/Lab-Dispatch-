"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import { maybeNotifyOffice } from "@/lib/heads-up";
import { requireDriverSession } from "@/lib/require-driver";
import { getTodaysRouteForDriver } from "@/lib/today-route";

export async function startRouteAction(routeId: string): Promise<void> {
  const session = await requireDriverSession();
  const storage = getServices().storage;
  const route = await storage.getRoute(routeId);
  if (!route) {
    throw new Error(`route ${routeId} not found`);
  }
  if (route.driverId !== session.userId) {
    throw new Error("not your route");
  }
  if (route.status !== "pending") {
    throw new Error(`route ${routeId} is not pending`);
  }
  await storage.updateRouteStatus(routeId, "active");
  revalidatePath("/driver");
  revalidatePath("/driver/route");
  redirect("/driver/route");
}

export async function completeRouteAction(routeId: string): Promise<void> {
  const session = await requireDriverSession();
  const storage = getServices().storage;
  const route = await storage.getRoute(routeId);
  if (!route) {
    throw new Error(`route ${routeId} not found`);
  }
  if (route.driverId !== session.userId) {
    throw new Error("not your route");
  }
  // Idempotent edge: the driver already finished (e.g. back button, double
  // submit, second tab). No state change needed — just bounce them home.
  if (route.status === "completed") {
    redirect("/driver");
  }
  // Unexpected-but-recoverable: the route never started. Log so we can spot
  // the trigger, then bounce home rather than crashing the UI.
  if (route.status !== "active") {
    // eslint-disable-next-line no-console
    console.warn(
      `completeRouteAction: route ${routeId} has unexpected status "${route.status}"; bouncing to /driver`,
    );
    redirect("/driver");
  }
  const stops = await storage.listStops(routeId);
  if (stops.some((s) => !s.pickedUpAt)) {
    throw new Error("cannot complete route: pending stops");
  }
  await storage.updateRouteStatus(routeId, "completed");
  revalidatePath("/driver");
  redirect("/driver");
}

export interface RecordLocationInput {
  lat: number;
  lng: number;
}

function isValidCoord(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

export async function recordLocationAction(
  input: RecordLocationInput,
): Promise<void> {
  const session = await requireDriverSession();
  if (!isValidCoord(input?.lat, -90, 90)) {
    throw new Error("invalid lat");
  }
  if (!isValidCoord(input?.lng, -180, 180)) {
    throw new Error("invalid lng");
  }
  const route = await getTodaysRouteForDriver(session.userId);
  if (route === null || route.status !== "active") {
    // Silent no-op: SPEC says sample while "on an active route"; outside
    // of that window we drop the ping rather than throw.
    return;
  }
  await getServices().storage.recordDriverLocation({
    driverId: session.userId,
    routeId: route.id,
    lat: input.lat,
    lng: input.lng,
  });

  // Best-effort heads-up SMS. Wrapped in try/catch so a heads-up failure
  // never fails the GPS ping ingestion — drivers' location updates are
  // load-bearing for the dispatcher map.
  try {
    await maybeNotifyOffice({
      driverId: session.userId,
      routeId: route.id,
      lat: input.lat,
      lng: input.lng,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("recordLocationAction: maybeNotifyOffice threw", err);
  }
}
