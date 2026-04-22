"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import type { AdminFormState } from "@/lib/admin-form";
import { requireDispatcherSession } from "@/lib/require-dispatcher";

const ROUTE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createRouteAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  requireDispatcherSession();
  const driverId = String(formData.get("driverId") ?? "").trim();
  const routeDate = String(formData.get("routeDate") ?? "").trim();

  const fieldErrors: Partial<Record<string, string>> = {};
  if (driverId.length === 0) {
    fieldErrors.driverId = "Choose a driver";
  }
  if (!ROUTE_DATE_RE.test(routeDate)) {
    fieldErrors.routeDate = "Enter a valid date";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const storage = getServices().storage;
  const driver = await storage.getDriver(driverId);
  if (!driver) {
    return { error: null, fieldErrors: { driverId: "Driver not found" } };
  }
  if (!driver.active) {
    return { error: null, fieldErrors: { driverId: "Driver is inactive" } };
  }

  let created;
  try {
    created = await storage.createRoute({ driverId, routeDate });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not create route",
      fieldErrors: {},
    };
  }

  revalidatePath("/dispatcher/routes");
  redirect(`/dispatcher/routes/${created.id}`);
}

export async function addStopToRouteAction(
  routeId: string,
  formData: FormData,
): Promise<void> {
  requireDispatcherSession();
  const pickupRequestId = String(formData.get("pickupRequestId") ?? "").trim();
  if (pickupRequestId.length === 0) {
    return;
  }
  await getServices().storage.assignRequestToRoute(routeId, pickupRequestId);
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/requests");
}

export async function removeStopAction(
  routeId: string,
  stopId: string,
): Promise<void> {
  requireDispatcherSession();
  await getServices().storage.removeStopFromRoute(stopId);
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/requests");
}

async function swapAndReorder(
  routeId: string,
  stopId: string,
  direction: "up" | "down",
): Promise<void> {
  const storage = getServices().storage;
  const stops = await storage.listStops(routeId);
  const idx = stops.findIndex((s) => s.id === stopId);
  if (idx === -1) return;
  const partnerIdx = direction === "up" ? idx - 1 : idx + 1;
  if (partnerIdx < 0 || partnerIdx >= stops.length) {
    return; // no-op at the edges
  }
  const newOrder = stops.map((s) => s.id);
  [newOrder[idx], newOrder[partnerIdx]] = [
    newOrder[partnerIdx] as string,
    newOrder[idx] as string,
  ];
  await storage.reorderStops(routeId, newOrder);
}

export async function moveStopUpAction(
  routeId: string,
  stopId: string,
): Promise<void> {
  requireDispatcherSession();
  await swapAndReorder(routeId, stopId, "up");
  revalidatePath(`/dispatcher/routes/${routeId}`);
}

export async function moveStopDownAction(
  routeId: string,
  stopId: string,
): Promise<void> {
  requireDispatcherSession();
  await swapAndReorder(routeId, stopId, "down");
  revalidatePath(`/dispatcher/routes/${routeId}`);
}

export async function startRouteAction(routeId: string): Promise<void> {
  requireDispatcherSession();
  await getServices().storage.updateRouteStatus(routeId, "active");
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/routes");
}

export async function completeRouteAction(routeId: string): Promise<void> {
  requireDispatcherSession();
  await getServices().storage.updateRouteStatus(routeId, "completed");
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/routes");
}

export async function resetRouteAction(routeId: string): Promise<void> {
  requireDispatcherSession();
  await getServices().storage.updateRouteStatus(routeId, "pending");
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/routes");
}
