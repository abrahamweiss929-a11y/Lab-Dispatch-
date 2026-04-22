"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import { requireDriverSession } from "@/lib/require-driver";
import { getTodaysRouteForDriver } from "@/lib/today-route";

export async function startRouteAction(routeId: string): Promise<void> {
  const session = requireDriverSession();
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
  const session = requireDriverSession();
  const storage = getServices().storage;
  const route = await storage.getRoute(routeId);
  if (!route) {
    throw new Error(`route ${routeId} not found`);
  }
  if (route.driverId !== session.userId) {
    throw new Error("not your route");
  }
  if (route.status !== "active") {
    throw new Error(`route ${routeId} is not active`);
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
  const session = requireDriverSession();
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
}
