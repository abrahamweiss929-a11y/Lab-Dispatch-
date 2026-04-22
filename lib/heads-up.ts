import { getServices } from "@/interfaces";
import { normalizeUsPhone } from "@/lib/phone";

/**
 * 10-minute heads-up module.
 *
 * Called from `recordLocationAction` AFTER the driver's GPS sample has
 * been persisted. This module resolves the next pending stop, checks
 * the ETA to its office, and — under the right conditions — sends the
 * office an SMS heads-up exactly once per stop. All failure modes
 * RESOLVE (never reject) with a typed outcome so the caller can log
 * without failing the GPS ingestion pipeline.
 *
 * The entire pipeline is mock-backed for v1; real adapters (Twilio,
 * Supabase) land later without changes here.
 */

export interface MaybeNotifyParams {
  driverId: string;
  routeId: string;
  lat: number;
  lng: number;
}

export type HeadsUpOutcome =
  | { status: "notified"; stopId: string; etaSeconds: number }
  | {
      status: "skipped";
      reason:
        | "no_next_stop"
        | "already_notified"
        | "no_office"
        | "no_office_coords"
        | "no_office_phone"
        | "eta_above_threshold"
        | "route_not_active";
    }
  | { status: "error"; error: string };

/**
 * Threshold: 12 minutes (720 seconds). SPEC says "~10 minutes"; we fire
 * a little early so drivers slightly ahead of schedule still trigger
 * the heads-up before they arrive. Single hard-coded constant — not
 * configurable in v1.
 */
export const HEADS_UP_THRESHOLD_SECONDS = 720;

/** The exact SMS body sent to the office. Asserted in tests. */
export const HEADS_UP_COPY = "Your sample pickup is ~10 minutes away.";

export async function maybeNotifyOffice(
  params: MaybeNotifyParams,
): Promise<HeadsUpOutcome> {
  const { storage, maps, sms } = getServices();

  // 1. Route must exist and be active.
  const route = await storage.getRoute(params.routeId);
  if (!route || route.status !== "active") {
    return { status: "skipped", reason: "route_not_active" };
  }

  // 2. First stop without a pickup timestamp is "next up".
  const stops = await storage.listStops(params.routeId);
  const nextStop = stops.find((s) => !s.pickedUpAt);
  if (!nextStop) {
    return { status: "skipped", reason: "no_next_stop" };
  }

  // 3. Already notified for this stop — single-shot per stop.
  if (nextStop.notified10min) {
    return { status: "skipped", reason: "already_notified" };
  }

  // 4. Resolve the office via the stop's pickup request.
  const request = await storage.getPickupRequest(nextStop.pickupRequestId);
  if (!request?.officeId) {
    return { status: "skipped", reason: "no_office" };
  }
  const office = await storage.getOffice(request.officeId);
  if (!office) {
    return { status: "skipped", reason: "no_office" };
  }

  // 5. Office must have coordinates to compute an ETA.
  if (office.lat === undefined || office.lng === undefined) {
    return { status: "skipped", reason: "no_office_coords" };
  }

  // 6. ETA check via the maps service.
  const eta = await maps.etaFor({
    from: { lat: params.lat, lng: params.lng },
    to: { lat: office.lat, lng: office.lng },
  });
  if (eta.durationSeconds >= HEADS_UP_THRESHOLD_SECONDS) {
    return { status: "skipped", reason: "eta_above_threshold" };
  }

  // 7. Office must have a sendable phone. When absent, still mark the
  //    flag so we don't recompute ETA on every subsequent ping — a phone
  //    that was missing a ping ago will not materialize mid-route.
  const normalizedPhone =
    office.phone !== undefined ? normalizeUsPhone(office.phone) : null;
  if (normalizedPhone === null) {
    try {
      await storage.markStopNotified10min(nextStop.id);
    } catch (err) {
      return {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    return { status: "skipped", reason: "no_office_phone" };
  }

  // 8. Send. On failure, do NOT mark notified — future pings can retry.
  try {
    await sms.sendSms({ to: normalizedPhone, body: HEADS_UP_COPY });
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 9. Persist the "sent" flag so the next ping won't re-send.
  try {
    await storage.markStopNotified10min(nextStop.id);
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    status: "notified",
    stopId: nextStop.id,
    etaSeconds: eta.durationSeconds,
  };
}
