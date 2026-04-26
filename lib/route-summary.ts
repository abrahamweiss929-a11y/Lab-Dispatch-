import "server-only";
import { getDriveTimes, type LatLng } from "./google-maps";

/**
 * Estimated time spent on each pickup itself (parking, paperwork, sample
 * handoff). Multiplied by the number of remaining un-picked-up stops.
 */
export const PICKUP_DWELL_MINUTES_PER_STOP = 7;

export interface RouteSummary {
  remainingStops: number;
  driveMinutes: number;
  pickupMinutes: number;
  totalMinutes: number;
  /** ISO string in UTC. Caller formats with a timezone of their choosing. */
  finishAtIso: string;
  /** Per-stop drive seconds, indexed identically to the input `stops` array. */
  driveSecondsPerLeg: number[];
  /** Per-stop ETA in ISO. Indexed identically to the input `stops` array. */
  etaIsoPerStop: string[];
  /** True when Google data was used; false when we fell back to estimates. */
  fromGoogle: boolean;
}

const FALLBACK_DRIVE_SECONDS_PER_LEG = 12 * 60; // 12 min — heads-up threshold

/**
 * Builds a summary of the un-picked-up stops on a route.
 *
 * Inputs:
 *  - `origin`: driver's current location, or first stop if unknown.
 *  - `stops`: lat/lngs of remaining stops in current order.
 *  - `now`: clock for tests; defaults to `new Date()`.
 *
 * On any Google failure (missing key, API error, partial data) the function
 * still returns a summary using `FALLBACK_DRIVE_SECONDS_PER_LEG` per leg.
 * Callers can branch on `fromGoogle` to suppress the "with traffic" copy.
 */
export async function buildRouteSummary(
  origin: LatLng,
  stops: LatLng[],
  now: Date = new Date(),
): Promise<RouteSummary> {
  if (stops.length === 0) {
    return {
      remainingStops: 0,
      driveMinutes: 0,
      pickupMinutes: 0,
      totalMinutes: 0,
      finishAtIso: now.toISOString(),
      driveSecondsPerLeg: [],
      etaIsoPerStop: [],
      fromGoogle: false,
    };
  }

  const driveSecondsPerLeg: number[] = [];
  let fromGoogle = true;
  let cursor = origin;
  for (const stop of stops) {
    const result = await getDriveTimes(cursor, [stop], now);
    if (!result || result.durationsSeconds.length !== 1) {
      fromGoogle = false;
      driveSecondsPerLeg.push(FALLBACK_DRIVE_SECONDS_PER_LEG);
    } else {
      driveSecondsPerLeg.push(result.durationsSeconds[0]);
    }
    cursor = stop;
  }

  const etaIsoPerStop: string[] = [];
  let elapsedMs = 0;
  for (let i = 0; i < stops.length; i++) {
    elapsedMs += driveSecondsPerLeg[i] * 1000;
    etaIsoPerStop.push(new Date(now.getTime() + elapsedMs).toISOString());
    // Add the dwell time *after* recording the ETA so the ETA represents
    // arrival at the stop, not departure from it.
    elapsedMs += PICKUP_DWELL_MINUTES_PER_STOP * 60 * 1000;
  }

  const totalDriveSeconds = driveSecondsPerLeg.reduce((a, b) => a + b, 0);
  const driveMinutes = Math.round(totalDriveSeconds / 60);
  const pickupMinutes = stops.length * PICKUP_DWELL_MINUTES_PER_STOP;
  const totalMinutes = driveMinutes + pickupMinutes;
  const finishAtIso = new Date(now.getTime() + totalMinutes * 60 * 1000).toISOString();

  return {
    remainingStops: stops.length,
    driveMinutes,
    pickupMinutes,
    totalMinutes,
    finishAtIso,
    driveSecondsPerLeg,
    etaIsoPerStop,
    fromGoogle,
  };
}

/**
 * Format `Date` (or ISO string) as `"h:mm a"` in UTC. Centralized here so
 * the driver UI doesn't sprinkle `Intl.DateTimeFormat` instances.
 */
export function formatHourMinute(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatDriveSeconds(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes}m`;
}
