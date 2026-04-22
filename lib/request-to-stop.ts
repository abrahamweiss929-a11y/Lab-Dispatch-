import { getServices } from "@/interfaces";
import type { Stop } from "@/lib/types";

/**
 * Thin orchestrator that wraps the "assign a pickup request to a route"
 * flow with best-effort ETA computation. Call sites (the dispatcher's
 * `addStopToRouteAction`, plus future re-use points) use this instead of
 * calling `storage.assignRequestToRoute` directly so that the ETA side
 * effect lives in one place.
 *
 * Contract:
 *   1. Always flips the pickup request to "assigned" via
 *      `storage.assignRequestToRoute(routeId, requestId, position)`.
 *      Errors from that call propagate unchanged.
 *   2. When the new stop has a preceding stop on the route AND both
 *      offices have `lat`/`lng` coordinates, calls `maps.etaFor` and
 *      persists `etaAt = now + durationSeconds * 1000` via
 *      `storage.updateStopEta`.
 *   3. Any failure in the ETA branch (missing data, maps throws, update
 *      throws) is swallowed — the stop assignment is the contract, the
 *      ETA is best-effort metadata.
 *
 * Returns the Stop row as stored (with `etaAt` populated when computed,
 * else as `assignRequestToRoute` returned it).
 */
export interface ConvertRequestToStopParams {
  routeId: string;
  requestId: string;
  /** Same semantics as `storage.assignRequestToRoute`'s `position`. */
  position?: number;
}

export async function convertRequestToStop(
  params: ConvertRequestToStopParams,
): Promise<Stop> {
  const { storage, maps } = getServices();
  const stop = await storage.assignRequestToRoute(
    params.routeId,
    params.requestId,
    params.position,
  );

  // Best-effort ETA — never throws out of this function.
  try {
    if (stop.position <= 1) {
      return stop;
    }

    const allStops = await storage.listStops(params.routeId);
    const prevStop = allStops.find((s) => s.position === stop.position - 1);
    if (!prevStop) {
      return stop;
    }

    const [prevRequest, newRequest] = await Promise.all([
      storage.getPickupRequest(prevStop.pickupRequestId),
      storage.getPickupRequest(stop.pickupRequestId),
    ]);
    if (!prevRequest?.officeId || !newRequest?.officeId) {
      return stop;
    }

    const [prevOffice, newOffice] = await Promise.all([
      storage.getOffice(prevRequest.officeId),
      storage.getOffice(newRequest.officeId),
    ]);
    if (
      !prevOffice ||
      prevOffice.lat === undefined ||
      prevOffice.lng === undefined ||
      !newOffice ||
      newOffice.lat === undefined ||
      newOffice.lng === undefined
    ) {
      return stop;
    }

    const eta = await maps.etaFor({
      from: { lat: prevOffice.lat, lng: prevOffice.lng },
      to: { lat: newOffice.lat, lng: newOffice.lng },
    });
    const etaAtIso = new Date(
      Date.now() + eta.durationSeconds * 1000,
    ).toISOString();
    const withEta = await storage.updateStopEta(stop.id, etaAtIso);
    return withEta;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("convertRequestToStop: ETA compute failed", err);
    return stop;
  }
}
