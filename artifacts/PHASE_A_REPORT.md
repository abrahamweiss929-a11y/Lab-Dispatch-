# Phase A — Google Maps smart routing

Branch: `feat/google-routing` (off `main` @ `df4784a`)
Tests: **734 passing** (was 700; +34 new). `npx tsc --noEmit` clean.

## What shipped

### `lib/google-maps.ts` — Google adapter

- `getDriveTimes(origin, destinations[], departure_time)` calls Distance Matrix with `traffic_model=best_guess`. Returns durations from `duration_in_traffic` (falls back to `duration` when traffic data is absent).
- `optimizeRoute(origin, waypoints, destination)` calls Directions with `optimize_waypoints=true`. Returns the permutation + total drive seconds.
- 15-minute in-memory cache, keyed by lat/lng tuples rounded to 5 decimal places.
- **Graceful fallback**: missing key, HTTP failure, non-OK API status, partial payload, or fetch throw all return `null` and `console.warn` a one-liner. Never throws.
- 10-second `AbortController` timeout. API key is scrubbed from any error message before logging.
- `__resetGoogleMapsCache()` exported for tests.

### `/driver/route` updates

- New `RouteSummaryCard`: `"Today: N stops · ~Xm drive + Ym pickup · Finish by HH:MM"` plus `(with traffic)` / `(estimate)` indicator and a primary "**Open full route in Google Maps →**" button.
- Per-stop `🚗 12m · ETA 1:30 PM` strip on each non-completed `StopCard`.
- Logic in `lib/route-summary.ts`: pulls the driver's most-recent GPS sample (within 30 min) as origin; falls back to first un-picked-up stop. Per-leg drive time × `PICKUP_DWELL_MINUTES_PER_STOP=7` for pickup time. ETA accumulates drive + dwell so each stop's label is its arrival time.
- When Google is unavailable: card still renders using a 12-min/leg fallback (matches the existing heads-up threshold) and copy switches to `(estimate)`.
- `googleMapsRouteUrl()` builds the deep link with the right shape: 1 stop → `destination`-only; 2 stops → origin + destination; 3+ stops → origin + middle as `waypoints` + destination.

### `/dispatcher/routes/[id]` updates

- New "**Optimize order**" button in the Stops header. Visible only when `route.status !== "completed"` and there are ≥3 stops.
- Calls `optimizeRouteAction` (new server action). Renders an inline status toast in one of four tones:
  - `reordered` → green, includes minutes saved when computable.
  - `already_optimal` → blue.
  - `not_enough_stops` / `missing_coordinates` → yellow.
  - `unavailable` → red.
- Origin and destination are pinned (first and last un-picked-up stops). Only true intermediate waypoints reorder. Picked-up stops are kept at the front of the order array.
- Returns a typed `OptimizeRouteActionResult` instead of throwing — toast renders either way.
- Re-uses `getDriveTimes` to compute baseline minutes for the savings number; if any baseline call fails, the button still reorders and just hides the savings.

## Tests added (34)

| File | Count | Coverage |
|---|---|---|
| `lib/google-maps.test.ts` | 14 | success, fallback to `duration`, no key, HTTP failure, non-OK API, non-OK element, fetch throw + key scrubbed, cache hit, empty input; `optimizeRoute`: success, length mismatch, non-OK status, empty input, no key |
| `lib/google-maps-link.test.ts` | 4 | empty / 1 stop / 2 stops / 4 stops URL formatting |
| `lib/route-summary.test.ts` | 7 | empty, drive+pickup math, ETA accumulation, fallback when no key; `formatHourMinute` and `formatDriveSeconds` |
| `app/driver/route/_components/RouteSummaryCard.test.tsx` | 3 | empty render, traffic-mode + link, estimate-mode no-link |
| `app/dispatcher/routes/actions.test.ts` (`optimizeRouteAction`) | 6 | not_enough_stops, missing_coordinates, unavailable, already_optimal, reorder happy path (4 stops, middle two swap), auth bail |

## Notes / tradeoffs

- Driver's "current location" relies on `listDriverLocations({ sinceMinutes: 30 })`. If no recent ping (e.g. before they tap "Start route"), origin falls back to the first stop. ETAs in that case start from "the moment they leave stop 1" — still useful, just not literal.
- The driver page issues `getDriveTimes` once per leg (not a single Distance Matrix call with all destinations). Trade-off: the cache key matches the natural call shape (origin → next stop), so consecutive page renders stay fully cached. Cost is ~3 API calls for a 3-stop route, all sub-second.
- `optimizeRouteAction` posts back a `OptimizeRouteActionResult` and the client uses `useTransition` for the pending state — works the same in mock and real-mode.
- No persistence of optimization runs. The button can be re-pressed; cache makes the second press cheap.

## Out of scope (for later)

- Origin defaulting to a configured "lab address" rather than the driver's GPS. The system has no lab-location config today.
- Showing the optimized polyline inside the existing Mapbox view (`feat/maps-everywhere` branch). The two features are independent and either can ship first.
- Per-leg drive time displayed inside `/dispatcher/routes/[id]` stop rows. Only the driver view shows them today.

## Manual setup needed

- `GOOGLE_MAPS_API_KEY` must be set in production env (already present in `.env.local`).
- Distance Matrix API + Directions API must be enabled on the project. Both billed per-request; with the 15-min cache and small route sizes this is well under the free tier for development.
