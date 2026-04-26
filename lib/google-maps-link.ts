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
