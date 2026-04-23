import "server-only";
import { NotConfiguredError } from "@/lib/errors";
import type {
  EtaParams,
  EtaResult,
  LatLng,
  MapsService,
  RouteFromStopsParams,
  RouteFromStopsResult,
} from "./maps";

/**
 * Real Mapbox-backed implementation of `MapsService`.
 *
 * Design constraints:
 *   - Hermetic-by-default: tests mock `global.fetch`; no real network
 *     call is ever made from the test suite.
 *   - Never logs or echoes the token. Not full, not masked, not first/last
 *     N chars. Every error message and `console.error` call runs through
 *     `scrubToken()` before surfacing.
 *   - Lazy `NotConfiguredError`: missing `NEXT_PUBLIC_MAPBOX_TOKEN` throws
 *     only at method-call time, matching `interfaces/ai.real.ts`'s
 *     `getClient()` pattern. Keeps `getServices()` cheap for callers that
 *     never invoke maps under `USE_MOCKS=false`.
 *   - 10-second fetch timeout on every outbound HTTP call via
 *     `AbortController`. On abort we throw a generic "maps request timed
 *     out" with no URL / token detail.
 *   - No `GET /.../<user-input>` path interpolation. Geocode query segment
 *     is `encodeURIComponent`'d; Directions coord string is built from
 *     `LatLng` numbers only. `URL` + `searchParams.set` handles query
 *     params so the token is never string-interpolated into a path.
 *   - `"server-only"`: webpack/Next will hard-error if this file is pulled
 *     into a Client Component. `NEXT_PUBLIC_MAPBOX_TOKEN` is `pk.*`
 *     public-safe, but gating every call through the server keeps one
 *     policy and avoids a future `sk.*` secret token accidentally leaking.
 */

// Mapbox REST bases. Versioned (`/v5/`) and stable.
const GEOCODE_BASE = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const DIRECTIONS_BASE = "https://api.mapbox.com/directions/v5/mapbox/driving";

// Upper bound on any single Mapbox call. Larger than the ~2s p99 we expect
// but small enough that a hung route-compute never stalls the dispatcher
// UI or the driver heads-up flow.
const FETCH_TIMEOUT_MS = 10_000;

// v1 is US-only per SPEC.
const GEOCODE_COUNTRY = "us";

// Filter out POIs / neighborhoods, focus on deliverable addresses.
const GEOCODE_TYPES = "address,place";

/**
 * Replace every literal occurrence of the token with `[redacted]`.
 * Plus defensively strip any `access_token=<non-&>` query parameter that
 * might show up in SDK-/URL-derived error strings. Belt-and-suspenders:
 * the REST client never string-interpolates the token into paths, but we
 * still scrub so that if Mapbox or Node echo back a URL in an error body
 * we don't forward it to logs.
 */
function scrubToken(s: string, token: string): string {
  if (!token) return s;
  return s
    .split(token)
    .join("[redacted]")
    .replace(/access_token=[^&\s"']+/g, "access_token=[redacted]");
}

/**
 * Fetches `url` with a 10-second abort timeout. Two failure surfaces:
 *   - Abort (timer elapsed) → throws `Error("maps request timed out")`.
 *   - Network throw (DNS, TLS, connection reset, SDK error) → throws a
 *     new `Error` with the scrubbed message.
 * Either way, no token or Mapbox-internal payload survives.
 */
async function fetchWithTimeout(url: URL, token: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("maps request timed out");
    }
    const message =
      err instanceof Error ? err.message : String(err);
    throw new Error(scrubToken(message, token));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read `Response.text()` without ever rejecting. Used to attach a
 * scrubbed response body to `console.error` on non-2xx — if the read
 * itself throws, we just log `""`.
 */
async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

export function createRealMapsService(): MapsService {
  // Env check is deferred to first use — matches `ai.real.ts`'s
  // `getClient()` pattern. Keeps `getServices()` cheap when
  // `USE_MOCKS=false` but callers never touch maps. No caching of the
  // token — it's a cheap `process.env` read and leaving it uncached
  // means hot-reload test patterns work without `vi.resetModules()`
  // for every test.
  function getToken(): string {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      throw new NotConfiguredError({
        service: "maps (Mapbox)",
        envVar: "NEXT_PUBLIC_MAPBOX_TOKEN",
      });
    }
    return token;
  }

  async function geocode(address: string): Promise<LatLng> {
    const token = getToken();
    const url = new URL(
      `${GEOCODE_BASE}/${encodeURIComponent(address)}.json`,
    );
    url.searchParams.set("access_token", token);
    url.searchParams.set("limit", "1");
    url.searchParams.set("country", GEOCODE_COUNTRY);
    url.searchParams.set("types", GEOCODE_TYPES);

    const resp = await fetchWithTimeout(url, token);
    if (!resp.ok) {
      const body = await safeText(resp);
      console.error(
        "maps.geocode: Mapbox returned",
        resp.status,
        scrubToken(body, token),
      );
      throw new Error(`maps.geocode: Mapbox returned ${resp.status}`);
    }

    const data = (await resp.json()) as {
      features?: Array<{ center?: [number, number] }>;
    };
    const first = data.features && data.features[0];
    if (!first || !first.center) {
      throw new Error(`maps.geocode: no results for ${address}`);
    }
    const [lng, lat] = first.center;
    return { lat, lng };
  }

  async function routeFor(
    params: RouteFromStopsParams,
  ): Promise<RouteFromStopsResult> {
    if (params.stops.length < 2) {
      throw new Error("maps.routeFor: need at least 2 stops");
    }
    const token = getToken();
    const coordsPath = params.stops
      .map((s) => `${s.lng},${s.lat}`)
      .join(";");
    const url = new URL(`${DIRECTIONS_BASE}/${coordsPath}`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("geometries", "polyline");
    url.searchParams.set("overview", "full");

    const resp = await fetchWithTimeout(url, token);
    if (!resp.ok) {
      const body = await safeText(resp);
      console.error(
        "maps.routeFor: Mapbox returned",
        resp.status,
        scrubToken(body, token),
      );
      throw new Error(`maps.routeFor: Mapbox returned ${resp.status}`);
    }

    const data = (await resp.json()) as {
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: string;
      }>;
    };
    const route = data.routes && data.routes[0];
    if (!route) {
      throw new Error("maps.routeFor: no routes found");
    }
    if (
      typeof route.distance !== "number" ||
      typeof route.duration !== "number" ||
      typeof route.geometry !== "string"
    ) {
      throw new Error("maps.routeFor: malformed route response");
    }
    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      polyline: route.geometry,
    };
  }

  async function etaFor(params: EtaParams): Promise<EtaResult> {
    const token = getToken();
    const { from, to } = params;
    const coordsPath = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = new URL(`${DIRECTIONS_BASE}/${coordsPath}`);
    url.searchParams.set("access_token", token);
    // ETA-only: skip polyline to save bandwidth. We only read `duration`.
    url.searchParams.set("overview", "false");

    const resp = await fetchWithTimeout(url, token);
    if (!resp.ok) {
      const body = await safeText(resp);
      console.error(
        "maps.etaFor: Mapbox returned",
        resp.status,
        scrubToken(body, token),
      );
      throw new Error(`maps.etaFor: Mapbox returned ${resp.status}`);
    }

    const data = (await resp.json()) as {
      routes?: Array<{ duration?: number }>;
    };
    const route = data.routes && data.routes[0];
    if (!route || typeof route.duration !== "number") {
      throw new Error("maps.etaFor: no route found");
    }
    return { durationSeconds: route.duration };
  }

  return { geocode, routeFor, etaFor };
}
