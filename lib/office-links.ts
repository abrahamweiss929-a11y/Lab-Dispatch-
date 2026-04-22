import type { OfficeAddress } from "@/lib/types";

/**
 * Builds a Google Maps "search" deep link for an office address.
 *
 * Used by the driver UI as a temporary navigation affordance until the
 * Mapbox integration lands (see BLOCKERS [mapbox]). If any address field
 * is empty, the query simply omits it; an entirely-empty address returns
 * the base URL with `query=`.
 */
export function googleMapsSearchUrl(address: OfficeAddress): string {
  const parts = [
    address.street,
    address.city,
    address.state,
    address.zip,
  ]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0);
  const query = parts.join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
