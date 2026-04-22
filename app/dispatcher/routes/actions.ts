"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import type { AdminFormState } from "@/lib/admin-form";
import { canDispatcherEditRoute } from "@/lib/permissions";
import { convertRequestToStop } from "@/lib/request-to-stop";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import type { SessionCookieValue } from "@/lib/session";

const ROUTE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fetches the route and throws when the caller may not edit it under
 * `canDispatcherEditRoute`. Returns silently (without throwing) when the
 * route is missing — the caller matches existing "silent bail on bad
 * routeId" behavior elsewhere in this file. The auth gate
 * (`requireDispatcherSession`) already ran before this helper is called;
 * this helper layers the past-date guard on top.
 */
async function guardCanEditRoute(
  routeId: string,
  session: SessionCookieValue,
): Promise<void> {
  const route = await getServices().storage.getRoute(routeId);
  if (!route) return;
  if (
    !canDispatcherEditRoute({
      role: session.role,
      routeDate: route.routeDate,
    })
  ) {
    throw new Error("cannot edit past route");
  }
}

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
  const session = requireDispatcherSession();
  const pickupRequestId = String(formData.get("pickupRequestId") ?? "").trim();
  if (pickupRequestId.length === 0) {
    return;
  }
  await guardCanEditRoute(routeId, session);
  await convertRequestToStop({ routeId, requestId: pickupRequestId });
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/requests");
}

export async function removeStopAction(
  routeId: string,
  stopId: string,
): Promise<void> {
  const session = requireDispatcherSession();
  await guardCanEditRoute(routeId, session);
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
  const session = requireDispatcherSession();
  await guardCanEditRoute(routeId, session);
  await swapAndReorder(routeId, stopId, "up");
  revalidatePath(`/dispatcher/routes/${routeId}`);
}

export async function moveStopDownAction(
  routeId: string,
  stopId: string,
): Promise<void> {
  const session = requireDispatcherSession();
  await guardCanEditRoute(routeId, session);
  await swapAndReorder(routeId, stopId, "down");
  revalidatePath(`/dispatcher/routes/${routeId}`);
}

export async function startRouteAction(routeId: string): Promise<void> {
  const session = requireDispatcherSession();
  await guardCanEditRoute(routeId, session);
  await getServices().storage.updateRouteStatus(routeId, "active");
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/routes");
}

export async function completeRouteAction(routeId: string): Promise<void> {
  const session = requireDispatcherSession();
  await guardCanEditRoute(routeId, session);
  await getServices().storage.updateRouteStatus(routeId, "completed");
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/routes");
}

export async function resetRouteAction(routeId: string): Promise<void> {
  const session = requireDispatcherSession();
  await guardCanEditRoute(routeId, session);
  await getServices().storage.updateRouteStatus(routeId, "pending");
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/routes");
}
