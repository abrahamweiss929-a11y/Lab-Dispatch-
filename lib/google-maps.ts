import "server-only";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface DriveTimesResult {
  durationsSeconds: number[];
}

export interface OptimizeRouteResult {
  /**
   * Permutation of `waypoints` produced by Google's `optimize_waypoints=true`.
   * E.g. `[2, 0, 1]` means the optimal order is waypoints[2], then [0], then [1].
   */
  order: number[];
  /** Total drive time of the optimized route in seconds. */
  totalSeconds: number;
}

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 15 * 60 * 1000;

const DM_BASE = "https://maps.googleapis.com/maps/api/distancematrix/json";
const DIR_BASE = "https://maps.googleapis.com/maps/api/directions/json";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const driveTimesCache = new Map<string, CacheEntry<DriveTimesResult>>();
const optimizeCache = new Map<string, CacheEntry<OptimizeRouteResult>>();

function roundCoord(n: number): string {
  // 5 decimal places ≈ 1.1m precision — enough that two GPS samples from
  // the same building share a cache key.
  return n.toFixed(5);
}

function pointKey(p: LatLng): string {
  return `${roundCoord(p.lat)},${roundCoord(p.lng)}`;
}

function pointsKey(points: LatLng[]): string {
  return points.map(pointKey).join("|");
}

function getKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.warn(
      "google-maps: GOOGLE_MAPS_API_KEY is not set; smart-routing features disabled",
    );
    return null;
  }
  return key;
}

function scrubKey(s: string, key: string): string {
  if (!key) return s;
  return s.split(key).join("[redacted]").replace(/key=[^&\s"']+/g, "key=[redacted]");
}

async function fetchWithTimeout(url: URL, key: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("google-maps: request timed out");
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(scrubKey(msg, key));
  } finally {
    clearTimeout(timer);
  }
}

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Distance Matrix lookup with traffic. Returns one duration per destination,
 * in seconds. On any failure (missing key, timeout, non-OK response, malformed
 * payload) returns `null` and logs a warning — callers degrade to a non-Google
 * UI rather than crashing.
 */
export async function getDriveTimes(
  origin: LatLng,
  destinations: LatLng[],
  departureTime: Date | "now" = "now",
): Promise<DriveTimesResult | null> {
  if (destinations.length === 0) {
    return { durationsSeconds: [] };
  }
  const key = getKey();
  if (!key) return null;

  const cacheKey = `${pointKey(origin)}>>${pointsKey(destinations)}`;
  const cached = cacheGet(driveTimesCache, cacheKey);
  if (cached) return cached;

  const url = new URL(DM_BASE);
  url.searchParams.set("origins", pointKey(origin).replace(",", ","));
  url.searchParams.set(
    "destinations",
    destinations.map((d) => `${d.lat},${d.lng}`).join("|"),
  );
  url.searchParams.set("mode", "driving");
  url.searchParams.set("traffic_model", "best_guess");
  const departureParam =
    departureTime === "now"
      ? "now"
      : Math.floor(departureTime.getTime() / 1000).toString();
  url.searchParams.set("departure_time", departureParam);
  url.searchParams.set("key", key);

  try {
    const resp = await fetchWithTimeout(url, key);
    if (!resp.ok) {
      console.warn(
        `google-maps.getDriveTimes: HTTP ${resp.status}; degrading to no-Google view`,
      );
      return null;
    }
    const data = (await resp.json()) as {
      status?: string;
      rows?: Array<{
        elements?: Array<{
          status?: string;
          duration_in_traffic?: { value?: number };
          duration?: { value?: number };
        }>;
      }>;
    };
    if (data.status !== "OK") {
      console.warn(
        `google-maps.getDriveTimes: API status ${data.status ?? "unknown"}; degrading`,
      );
      return null;
    }
    const elements = data.rows?.[0]?.elements;
    if (!elements || elements.length !== destinations.length) {
      console.warn(
        "google-maps.getDriveTimes: malformed payload; degrading to no-Google view",
      );
      return null;
    }
    const durations: number[] = [];
    for (const el of elements) {
      if (el.status !== "OK") {
        console.warn(
          `google-maps.getDriveTimes: element status ${el.status ?? "unknown"}; degrading`,
        );
        return null;
      }
      const seconds = el.duration_in_traffic?.value ?? el.duration?.value;
      if (typeof seconds !== "number") {
        console.warn("google-maps.getDriveTimes: missing duration; degrading");
        return null;
      }
      durations.push(seconds);
    }
    const result: DriveTimesResult = { durationsSeconds: durations };
    cacheSet(driveTimesCache, cacheKey, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`google-maps.getDriveTimes: ${scrubKey(msg, key)}`);
    return null;
  }
}

/**
 * Calls the Directions API with `optimize_waypoints=true`. Returns a
 * permutation describing the optimal order of `waypoints`, plus total drive
 * seconds. Returns `null` on any failure — callers leave the existing order.
 */
export async function optimizeRoute(
  origin: LatLng,
  waypoints: LatLng[],
  destination: LatLng,
): Promise<OptimizeRouteResult | null> {
  if (waypoints.length === 0) {
    return { order: [], totalSeconds: 0 };
  }
  const key = getKey();
  if (!key) return null;

  const cacheKey = `${pointKey(origin)}>>${pointsKey(waypoints)}>>${pointKey(destination)}`;
  const cached = cacheGet(optimizeCache, cacheKey);
  if (cached) return cached;

  const url = new URL(DIR_BASE);
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  url.searchParams.set(
    "waypoints",
    `optimize:true|${waypoints.map((w) => `${w.lat},${w.lng}`).join("|")}`,
  );
  url.searchParams.set("mode", "driving");
  url.searchParams.set("departure_time", "now");
  url.searchParams.set("traffic_model", "best_guess");
  url.searchParams.set("key", key);

  try {
    const resp = await fetchWithTimeout(url, key);
    if (!resp.ok) {
      console.warn(
        `google-maps.optimizeRoute: HTTP ${resp.status}; leaving order unchanged`,
      );
      return null;
    }
    const data = (await resp.json()) as {
      status?: string;
      routes?: Array<{
        waypoint_order?: number[];
        legs?: Array<{
          duration_in_traffic?: { value?: number };
          duration?: { value?: number };
        }>;
      }>;
    };
    if (data.status !== "OK") {
      console.warn(
        `google-maps.optimizeRoute: API status ${data.status ?? "unknown"}; leaving order unchanged`,
      );
      return null;
    }
    const route = data.routes?.[0];
    if (!route || !Array.isArray(route.waypoint_order) || !route.legs) {
      console.warn(
        "google-maps.optimizeRoute: malformed payload; leaving order unchanged",
      );
      return null;
    }
    if (route.waypoint_order.length !== waypoints.length) {
      console.warn(
        "google-maps.optimizeRoute: waypoint_order length mismatch; leaving order unchanged",
      );
      return null;
    }
    let totalSeconds = 0;
    for (const leg of route.legs) {
      const sec = leg.duration_in_traffic?.value ?? leg.duration?.value;
      if (typeof sec !== "number") {
        console.warn("google-maps.optimizeRoute: missing leg duration; degrading");
        return null;
      }
      totalSeconds += sec;
    }
    const result: OptimizeRouteResult = {
      order: route.waypoint_order.slice(),
      totalSeconds,
    };
    cacheSet(optimizeCache, cacheKey, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`google-maps.optimizeRoute: ${scrubKey(msg, key)}`);
    return null;
  }
}

/** Test-only: clears all in-memory caches. */
export function __resetGoogleMapsCache(): void {
  driveTimesCache.clear();
  optimizeCache.clear();
}
