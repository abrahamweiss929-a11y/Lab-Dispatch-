/**
 * v1 placeholder. Returns a human-readable ETA fragment used by the
 * public pickup-request confirmation card. Real ETAs will come from
 * dispatcher route planning (Mapbox travel-time) once that feature
 * lands; replacing this function is a deliberate test update.
 */
export function estimateEtaText(): string {
  return "within about 2 hours";
}
