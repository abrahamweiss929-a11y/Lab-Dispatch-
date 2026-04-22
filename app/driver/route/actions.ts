"use server";

import { revalidatePath } from "next/cache";
import { getServices } from "@/interfaces";
import { requireDriverSession } from "@/lib/require-driver";

async function loadActiveStopForDriver(stopId: string, driverId: string) {
  const storage = getServices().storage;
  const stop = await storage.getStop(stopId);
  if (!stop) {
    throw new Error(`stop ${stopId} not found`);
  }
  const route = await storage.getRoute(stop.routeId);
  if (!route) {
    throw new Error(`route ${stop.routeId} not found`);
  }
  if (route.driverId !== driverId) {
    throw new Error("not your stop");
  }
  if (route.status !== "active") {
    throw new Error("route not active");
  }
  return { stop, route };
}

export async function arriveAtStopAction(stopId: string): Promise<void> {
  const session = requireDriverSession();
  await loadActiveStopForDriver(stopId, session.userId);
  await getServices().storage.markStopArrived(stopId);
  revalidatePath("/driver/route");
  revalidatePath(`/driver/route/${stopId}`);
  revalidatePath("/driver");
}

export async function pickupStopAction(stopId: string): Promise<void> {
  const session = requireDriverSession();
  await loadActiveStopForDriver(stopId, session.userId);
  await getServices().storage.markStopPickedUp(stopId);
  revalidatePath("/driver/route");
  revalidatePath(`/driver/route/${stopId}`);
  revalidatePath("/driver");
}
