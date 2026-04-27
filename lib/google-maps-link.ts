import type { LatLng } from "./google-maps";

/**
 * Builds a Google Maps "navigate" deep link for a multi-stop trip.
 *
 *  - 0 stops → returns null.
 *  - 1 stop → simple search URL with that one destination.
 *  - 2+ stops → first stop becomes the origin (driver opens the link from
 *    where they are; we'll let Google use device location if the page
 *    is opened on a phone — but explicitly setting origin to the first
 *    pickup keeps the URL deterministic). The last stop is the
 *    destination; intermediate stops are waypoints.
 */
export function googleMapsRouteUrl(stops: LatLng[]): string | null {
  if (stops.length === 0) return null;
  if (stops.length === 1) {
    const s = stops[0];
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("destination", `${s.lat},${s.lng}`);
    url.searchParams.set("travelmode", "driving");
    return url.toString();
  }
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(1, -1);
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set(
    "destination",
    `${destination.lat},${destination.lng}`,
  );
  if (waypoints.length > 0) {
    url.searchParams.set(
      "waypoints",
      waypoints.map((w) => `${w.lat},${w.lng}`).join("|"),
    );
  }
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

/**
 * Google Maps caps waypoints at 9 intermediate stops (10 total stops
 * counting the destination). Slicing more silently drops them server-side,
 * so we cap explicitly on the client.
 */
const MAX_WAYPOINTS = 9;

/**
 * Builds a Google Maps deep link with a single destination. URL-encodes
 * the address so commas / spaces / accents survive intact.
 */
export function googleMapsSingleStopUrl(address: string): string {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", address);
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

/**
 * Builds a multi-stop Google Maps deep link **from addresses** (not
 * lat/lng). On mobile this opens the Google Maps app; on desktop, the
 * Maps website.
 *
 *  - 0 addresses → returns null.
 *  - 1 address → uses `googleMapsSingleStopUrl` (no origin specified
 *    so Google uses device location).
 *  - 2+ addresses → origin = "My Location" (forces device location),
 *    destination = last address, waypoints = middle addresses.
 *    Caps waypoints at 9 (Google's limit) by trimming from the END
 *    of the middle list (keeping origin + first waypoints + final
 *    destination).
 *
 * URL-encoding handled by `URL.searchParams.set` automatically.
 */
export function googleMapsRouteUrlFromAddresses(
  addresses: readonly string[],
): string | null {
  if (addresses.length === 0) return null;
  if (addresses.length === 1) {
    return googleMapsSingleStopUrl(addresses[0]!);
  }

  const destination = addresses[addresses.length - 1]!;
  const waypoints = addresses.slice(0, -1).slice(0, MAX_WAYPOINTS);

  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", "My Location");
  url.searchParams.set("destination", destination);
  if (waypoints.length > 0) {
    url.searchParams.set("waypoints", waypoints.join("|"));
  }
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}
