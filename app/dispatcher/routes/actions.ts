"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import type { AdminFormState } from "@/lib/admin-form";
import { getDriveTimes, optimizeRoute, type LatLng } from "@/lib/google-maps";
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
  await requireDispatcherSession();
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

  // Optional multi-select: form may pass requestIds (formData.getAll
  // returns every value for a repeated checkbox name). Each selected
  // pending request becomes a stop on the new route, in the order
  // submitted. Best-effort — a single bad request doesn't roll back
  // the route creation.
  const requestIds = formData
    .getAll("requestIds")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);

  for (const requestId of requestIds) {
    try {
      await storage.assignRequestToRoute(created.id, requestId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `createRouteAction: failed to assign request ${requestId}`,
        err,
      );
    }
  }

  revalidatePath("/dispatcher/routes");
  if (requestIds.length > 0) {
    revalidatePath("/dispatcher/requests");
  }
  redirect(`/dispatcher/routes/${created.id}`);
}

export async function addStopToRouteAction(
  routeId: string,
  formData: FormData,
): Promise<void> {
  const session = await requireDispatcherSession();
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
  const session = await requireDispatcherSession();
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
  const session = await requireDispatcherSession();
  await guardCanEditRoute(routeId, session);
  await swapAndReorder(routeId, stopId, "up");
  revalidatePath(`/dispatcher/routes/${routeId}`);
}

export async function moveStopDownAction(
  routeId: string,
  stopId: string,
): Promise<void> {
  const session = await requireDispatcherSession();
  await guardCanEditRoute(routeId, session);
  await swapAndReorder(routeId, stopId, "down");
  revalidatePath(`/dispatcher/routes/${routeId}`);
}

export async function startRouteAction(routeId: string): Promise<void> {
  const session = await requireDispatcherSession();
  await guardCanEditRoute(routeId, session);
  await getServices().storage.updateRouteStatus(routeId, "active");
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/routes");
}

export async function completeRouteAction(routeId: string): Promise<void> {
  const session = await requireDispatcherSession();
  await guardCanEditRoute(routeId, session);
  await getServices().storage.updateRouteStatus(routeId, "completed");
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/routes");
}

export async function resetRouteAction(routeId: string): Promise<void> {
  const session = await requireDispatcherSession();
  await guardCanEditRoute(routeId, session);
  await getServices().storage.updateRouteStatus(routeId, "pending");
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/routes");
}

export type OptimizeRouteResultStatus =
  | "reordered"
  | "already_optimal"
  | "unavailable"
  | "not_enough_stops"
  | "missing_coordinates";

export interface OptimizeRouteActionResult {
  status: OptimizeRouteResultStatus;
  /** Friendly toast text. */
  message: string;
  /** Estimated minutes saved (>=0). Only set when `status === "reordered"`. */
  minutesSaved?: number;
}

/**
 * Re-orders the un-picked-up stops on `routeId` according to Google's
 * `optimize_waypoints=true`. Always preserves stop[0] as origin and the
 * last un-picked-up stop as destination — only true intermediate
 * waypoints are reorderable.
 *
 * Idempotent and safe to spam: when Google returns the identity
 * permutation we return `"already_optimal"` without touching storage.
 *
 * Returns a typed result rather than throwing so the dispatcher UI can
 * render a toast either way.
 */
export async function optimizeRouteAction(
  routeId: string,
): Promise<OptimizeRouteActionResult> {
  const session = await requireDispatcherSession();
  await guardCanEditRoute(routeId, session);

  const storage = getServices().storage;
  const [stops, requests, offices] = await Promise.all([
    storage.listStops(routeId),
    storage.listPickupRequests(),
    storage.listOffices(),
  ]);
  const requestById = new Map(requests.map((r) => [r.id, r] as const));
  const officeById = new Map(offices.map((o) => [o.id, o] as const));

  const remaining = stops.filter((s) => !s.pickedUpAt);
  if (remaining.length < 3) {
    return {
      status: "not_enough_stops",
      message: "Need at least 3 remaining stops to optimize.",
    };
  }

  const points: LatLng[] = [];
  for (const s of remaining) {
    const office = officeById.get(
      requestById.get(s.pickupRequestId)?.officeId ?? "",
    );
    if (
      !office ||
      typeof office.lat !== "number" ||
      typeof office.lng !== "number"
    ) {
      return {
        status: "missing_coordinates",
        message: "One or more offices are missing lat/lng — can't optimize.",
      };
    }
    points.push({ lat: office.lat, lng: office.lng });
  }

  const origin = points[0];
  const destination = points[points.length - 1];
  const waypoints = points.slice(1, -1);

  const optimized = await optimizeRoute(origin, waypoints, destination);
  if (!optimized) {
    return {
      status: "unavailable",
      message: "Google routing isn't available right now. Order unchanged.",
    };
  }

  const isIdentity = optimized.order.every((v, i) => v === i);
  if (isIdentity) {
    return {
      status: "already_optimal",
      message: "Already optimal — no changes.",
    };
  }

  // Compute baseline drive time for the current order so we can show "minutes
  // saved". A failure here just means we hide the savings number.
  let minutesSaved: number | undefined;
  const baselineDestinations: LatLng[] = [];
  let cursor = origin;
  // We could recompute leg-by-leg; instead use the simpler shape: origin to
  // each subsequent stop in current order. Then sum.
  for (let i = 1; i < points.length; i++) {
    const leg = await getDriveTimes(cursor, [points[i]]);
    if (!leg) {
      baselineDestinations.length = 0;
      break;
    }
    baselineDestinations.push(points[i]);
    cursor = points[i];
  }
  if (baselineDestinations.length === points.length - 1) {
    // Re-sum from cached drive times.
    let baselineSeconds = 0;
    let prev = origin;
    let ok = true;
    for (const p of baselineDestinations) {
      const r = await getDriveTimes(prev, [p]);
      if (!r) {
        ok = false;
        break;
      }
      baselineSeconds += r.durationsSeconds[0];
      prev = p;
    }
    if (ok && baselineSeconds > optimized.totalSeconds) {
      minutesSaved = Math.round(
        (baselineSeconds - optimized.totalSeconds) / 60,
      );
    }
  }

  // Apply: origin stays at index 0, destination at end, waypoints in
  // optimized.order between them.
  const orderedRemainingIds: string[] = [
    remaining[0].id,
    ...optimized.order.map((wpIdx) => remaining[wpIdx + 1].id),
    remaining[remaining.length - 1].id,
  ];
  // Combine with picked-up stops at the front (their position is fixed —
  // the driver already visited them).
  const pickedUpIds = stops.filter((s) => s.pickedUpAt).map((s) => s.id);
  await storage.reorderStops(routeId, [...pickedUpIds, ...orderedRemainingIds]);

  revalidatePath(`/dispatcher/routes/${routeId}`);

  const savingsText =
    typeof minutesSaved === "number" && minutesSaved > 0
      ? `~${minutesSaved}m saved`
      : "Reordered";
  return {
    status: "reordered",
    message: `${savingsText}. Drive total ${Math.round(optimized.totalSeconds / 60)}m.`,
    minutesSaved,
  };
}
