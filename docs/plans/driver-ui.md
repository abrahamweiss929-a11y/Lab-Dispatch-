# Plan: Driver UI — Today's Route, Stop Cards, Check-ins, GPS Sampling

**Slug:** driver-ui
**SPEC reference:** "Driver — mobile web interface. Sees today's route, stops in order, map, 'arrived' and 'picked up' buttons." under Account types; "Driver route view + check-ins + GPS tracking" under v1 features IN; "Live tracking — GPS sampling every 1–2 minutes when driver is on an active route. Manual 'arrived' and 'picked up' check-ins at each stop. Driver interface is mobile web only (no native app for v1)."
**Status:** draft

## Goal
Give a signed-in driver (on a phone browser) a working, mock-backed UI to (1) see whether they have a route today, (2) start and complete that route, (3) see their stops in order with urgency / sample-count / special-instructions context, (4) tap "I've arrived" and "Samples picked up" at each stop, and (5) stream foreground GPS samples to the server every ~60 seconds while a route is active. Every mutation is a server action; every read goes through `getServices().storage`; the storage interface gains four minimum-necessary methods (`getStop`, `markStopArrived`, `markStopPickedUp`, `recordDriverLocation`). Real Mapbox rendering stays deferred. This feature ends when a driver on a phone can walk through their day end-to-end against the mock and the dispatcher's `/dispatcher/map` page shows their pings landing.

## Out of scope
- Real Supabase storage adapter. `createRealStorageService()` gains matching `notConfigured()` stubs for every new method; no live DB calls.
- Real Mapbox map rendering on any `/driver/*` page. `/driver/route/[stopId]` renders an address block + "Open in Maps" deep link (`https://www.google.com/maps/search/?api=1&query=...` URL fallback; no native `geo:` scheme handling because iOS Safari's UX on `geo:` is inconsistent). A real inline map lands with the Mapbox integration feature. Deferred; see BLOCKERS `[mapbox]`.
- Background geolocation. We sample ONLY while `/driver/route` is mounted and the tab is foreground. When the driver backgrounds the tab or locks the phone, `watchPosition` naturally suspends; we do not fight this in v1. SPEC "GPS sampling every 1–2 minutes" is met while the app is in the foreground during an active route, which matches how the dispatcher will use the screen.
- Offline support / service worker / installability. No PWA manifest, no offline queue for failed check-ins. The driver needs an active connection; a future feature can queue actions in IndexedDB and replay.
- Sample-counts-per-pickup workflow (i.e. driver enters actual count at pickup time, potentially differing from the dispatcher-entered estimate). V1 shows the estimated `sampleCount` only.
- Push notifications (e.g. "new stop added to your route"). The driver sees changes on page refresh / revalidation.
- ETA recalculation via Mapbox Directions API. `Stop.etaAt` stays untouched in this feature; it was planned in `dispatcher-ui` as a future-feature surface.
- Route reassignment from the driver side. A driver cannot add/remove stops or reorder them — that's dispatcher territory.
- Admin impersonating a driver's CHECK-IN actions. Admin can view `/driver/*` pages (debugging convenience — middleware already permits admin anywhere) but every action (`startRouteAction`, `arriveAtStopAction`, `pickupStopAction`, `completeRouteAction`, `recordLocationAction`) rejects non-driver sessions. Rationale: check-in rows are audit trail for the driver's day; admins should not generate them.
- Driver CRUD (owned by `admin-ui`), driver-account creation, password reset flows.
- Driver-side viewing of other drivers' routes, day-before routes, or day-after routes. Only today's route for the signed-in driver.
- Component-rendering tests for pages and client forms. Same rationale as `dispatcher-ui` / `admin-ui`: load-bearing logic is in server actions + the storage mock, both unit-tested. Manual smoke covers the UI glue. Revisit when E2E lands.
- Component tests for `GpsSampler`. It leans on `navigator.geolocation.watchPosition` and `setInterval` — the browser-API mocking is heavy and the component's own logic is thin (just "latch latest position; fire server action every N seconds"). We test the server-action path (`recordLocationAction`) exhaustively instead. Documented as an explicit carve-out.

## Files to create or modify

### New: shared driver chrome
- `/Users/abraham/lab-dispatch/components/DriverLayout.tsx` — server component, mirrors `DispatcherLayout` structurally but tuned for mobile. Renders a single-column `max-w-md mx-auto` shell with a compact top header (lab wordmark + current driver's `fullName` + "Log out" link) and a main content area. No sidebar. Accepts `{ title?: string; driverName: string; children: ReactNode }`. The driver's `fullName` is passed in from each page (each page already loads the Driver record to show their name / today's route anyway). Large tap targets (≥ 44px) on the header's "Log out" affordance. Tailwind classes: `min-h-screen bg-gray-50`; inner wrapper `max-w-md mx-auto bg-white min-h-screen shadow-sm`; content area `px-4 pb-8`.
- `/Users/abraham/lab-dispatch/components/DriverNavLink.tsx` — client component. Much smaller nav than dispatcher/admin: only used if we decide to render "Route" / "Today" pill tabs at the top of the content area. **Decision: skip for v1** — there are only three driver routes (`/driver`, `/driver/route`, `/driver/route/[stopId]`) and they form a natural drill-down, not a side-by-side nav. The header shows a back-chevron `<` on `/driver/route` (→ `/driver`) and on `/driver/route/[stopId]` (→ `/driver/route`). This file is NOT created. Delete from scope if it survives a review pass.
- `/Users/abraham/lab-dispatch/app/driver/layout.tsx` — Next.js route segment layout for `/driver/**`. Exports `metadata: { viewport: "width=device-width, initial-scale=1, viewport-fit=cover" }` via the `viewport` export (Next 14+ uses a separate `export const viewport = { width: "device-width", initialScale: 1 }` surface — use that). Wraps `children` in an `<html>`-level body-safe wrapper only if the root `app/layout.tsx` doesn't already. Default shape: just `{children}` with the viewport export; `DriverLayout` is applied per-page because each page needs its own `driverName` and `title` values.
  - Note: the root `app/layout.tsx` already sets html/body. We only need the `viewport` export from this segment layout. Verify during implementation (Read `app/layout.tsx` first).
- `/Users/abraham/lab-dispatch/lib/require-driver.ts` — helper with TWO named exports:
  - `requireDriverSession(): SessionCookieValue` — STRICT driver only. Calls `getSession()`; if `session === null` or `session.role !== "driver"`, calls `redirect("/login")`. Used by every driver-initiated server action. Admins cannot issue check-ins.
  - `requireDriverOrAdminSession(): SessionCookieValue` — driver OR admin. Same pattern as `requireDispatcherSession`, but allowing `driver` + `admin`. Used by read-only page components so admins can debug-view driver screens.
  Both call `redirect("/login")` on mismatch (which throws in Next 14+, so callers may treat the return as non-null).
- `/Users/abraham/lab-dispatch/lib/require-driver.test.ts` — unit tests mirroring `require-dispatcher.test.ts`:
  - `requireDriverSession` — driver → returns; admin → redirect; dispatcher → redirect; null → redirect.
  - `requireDriverOrAdminSession` — driver → returns; admin → returns; dispatcher → redirect; null → redirect.
  Uses the same `vi.mock('@/lib/session', ...)` / `vi.mock('next/navigation', ...)` scaffold as `require-dispatcher.test.ts`.

### New: today-route helper
- `/Users/abraham/lab-dispatch/lib/today-route.ts` — helper module exporting `getTodaysRouteForDriver(driverId: string, timeZone?: string): Promise<Route | null>`. Calls `getServices().storage.listRoutes({ driverId, date: todayIso(timeZone) })`; returns `routes[0] ?? null`. There SHOULD be at most one route per driver per day (schema enforces this via `unique (driver_id, route_date)` on `public.routes` — note: verify this constraint exists in `supabase/schema.sql` during implementation; if missing, open as a BLOCKERS item but do not block this feature). This helper exists primarily to DRY three pages + one action; it is not exotic.
  - Default `timeZone` is `"UTC"` (see `lib/dates.ts` file-top comment re: per-lab TZ being future work).
- `/Users/abraham/lab-dispatch/lib/today-route.test.ts` — unit tests:
  - Happy: driver has one route today → returns it.
  - Empty: driver has no routes → returns `null`.
  - Empty: driver has routes on other days but not today → returns `null`.
  - Picks the first when multiple exist (defensive test; the real DB constraint should make this impossible, but the mock lets it happen — so we pin behavior). Sorted by `createdAt` (inherits from `storageMock.listRoutes`) — earliest-created wins.
  - Mocks `getServices()` to return a storage stub; uses `vi.useFakeTimers()` + `vi.setSystemTime(new Date("2026-04-22T10:00:00Z"))` for determinism on `todayIso()`.

### New: storage interface additions

See "Interfaces / contracts" for full signatures. At a glance:
- `getStop(id: string): Promise<Stop | null>` — returns a single stop or null. Needed by `/driver/route/[stopId]` detail page.
- `markStopArrived(stopId: string): Promise<Stop>` — sets `arrivedAt = now` if unset. Throws if stop missing OR already arrived.
- `markStopPickedUp(stopId: string): Promise<Stop>` — sets `pickedUpAt = now` if unset. Throws if stop missing OR not yet arrived OR already picked up.
- `recordDriverLocation(input: NewDriverLocation): Promise<DriverLocation>` — appends a row; `recordedAt` defaults to now; returns the new row.

Existing `storage.ts` / `mocks/storage.ts` state from `dispatcher-ui`:
- `state.stops: Map<string, Stop>` already exists — new methods operate on it.
- `state.driverLocations: DriverLocation[]` already exists — `recordDriverLocation` pushes onto it.
- `seedDriverLocation` test helper already exists and will continue to work.
- `listRoutes({ driverId, date })` already exists — `today-route.ts` uses it verbatim.
- `listStops(routeId)` already exists — driver pages use it verbatim.
- `updateRouteStatus(id, status)` already exists — `startRouteAction` / `completeRouteAction` use it verbatim.

No schema reconciliation this feature — `dispatcher-ui` already aligned `Route`, `Stop`, `DriverLocation`, and `Message` with `supabase/schema.sql`.

### New: driver "Today" page (replace placeholder)
- `/Users/abraham/lab-dispatch/app/driver/page.tsx` — REPLACE the current auth-skeleton placeholder. Async server component. Flow:
  1. `const session = requireDriverOrAdminSession()` — admin can view for debugging.
  2. Determine the driver id to load:
     - If `session.role === "driver"`: `driverId = session.userId` (the driver's `profileId`).
     - If `session.role === "admin"`: accept a `?driverId=...` search param; if missing, render a small "Admin view — no driver selected" message with a link back to `/admin/drivers`. This keeps admin debug-view functional without adding an admin-facing impersonation picker.
  3. `const driver = await storage.getDriver(driverId)`; if null, render a simple "Driver not found" block with log-out link.
  4. `const route = await getTodaysRouteForDriver(driver.profileId)`.
  5. If `route === null`, render the empty state: `<DriverLayout title="Today" driverName={driver.fullName}>` containing "No route assigned yet — check with your dispatcher." in muted text. A `formatDateIsoToShort(todayIso())` sub-line shows the current date.
  6. If `route !== null`:
     - `const stops = await storage.listStops(route.id)`.
     - Compute summary: `stopCount = stops.length`, `completedCount = stops.filter(s => s.pickedUpAt).length`.
     - Render: card with `route.status` badge (pending / active / completed), "Stops: X · Completed: Y" line, `formatDateIsoToShort(route.routeDate)`.
     - Action area depends on `route.status`:
       - `pending` → `<StartRouteButton routeId={route.id} />` (big full-width primary button labeled "Start route"). Shown only when `session.role === "driver"` (admins see a disabled hint instead: "Admin view — drivers start routes").
       - `active` → primary CTA "Open route" → `<Link href="/driver/route">`, plus `<CompleteRouteButton routeId={route.id} disabled={completedCount < stopCount} />` rendered beneath. The button is disabled whenever `completedCount < stopCount`. Server-side we also guard by re-checking (see actions).
       - `completed` → inert summary + a muted line "Route completed at {formatShortDateTime(route.completedAt)}".
- `/Users/abraham/lab-dispatch/app/driver/_components/StartRouteButton.tsx` — client component; wraps a `<form action={startRouteAction.bind(null, routeId)}>` with a full-width submit button. Minimum styling: `w-full py-4 text-lg rounded-xl bg-blue-600 text-white`. Disabled-while-pending via `useFormStatus`.
- `/Users/abraham/lab-dispatch/app/driver/_components/CompleteRouteButton.tsx` — client component; same wrapper pattern; disabled prop forces disabled state client-side (and the server action re-validates).
- `/Users/abraham/lab-dispatch/app/driver/actions.ts`:
  - `startRouteAction(routeId: string): Promise<void>` — bound. Calls `requireDriverSession()` (strict). Fetches `route = getRoute(routeId)` — throw if null OR `route.driverId !== session.userId`. Throw if `route.status !== "pending"`. Calls `updateRouteStatus(routeId, "active")`. `revalidatePath("/driver")` + `revalidatePath("/driver/route")` + `redirect("/driver/route")`.
  - `completeRouteAction(routeId: string): Promise<void>` — bound. `requireDriverSession()`. Fetches route; throws if null OR not owned by this driver OR `status !== "active"`. Fetches stops; throws if `stops.some(s => !s.pickedUpAt)` ("cannot complete route: pending stops"). Calls `updateRouteStatus(routeId, "completed")`. `revalidatePath("/driver")` + `redirect("/driver")`.
- `/Users/abraham/lab-dispatch/app/driver/actions.test.ts` — exhaustive unit tests (see "Tests to write").

### New: driver route (stop cards)
- `/Users/abraham/lab-dispatch/app/driver/route/page.tsx` — async server component. Flow:
  1. `session = requireDriverOrAdminSession()`.
  2. Resolve `driverId` as in `/driver` (session or `?driverId=` for admin).
  3. `driver = getDriver(driverId)`; `notFound()` if null.
  4. `route = await getTodaysRouteForDriver(driverId)`. If null → `redirect("/driver")` (empty state lives on `/driver`, not here — `/driver/route` always assumes a route exists).
  5. `stops = await listStops(route.id)`.
  6. For each stop, hydrate its pickup request + office:
     - Fetch `listPickupRequests()` once → build `Map<requestId, PickupRequest>`.
     - Fetch `listOffices()` once → build `Map<officeId, Office>`.
     - Zip: `stopView = { stop, request, office }`. Guard: `request?.officeId` might be undefined (unknown-sender request) — render "Unknown office" in that case; SPEC uses the web form for identified pickups and SMS/email-derived requests that a dispatcher then resolved to an office, so in practice every stop should have an office on the linked request, but the type says otherwise.
  7. Compute `currentStopIndex` = index of first stop where `pickedUpAt` is undefined (i.e. not yet picked up). -1 if all done.
  8. Render inside `<DriverLayout title="Today's route" driverName={driver.fullName}>`:
     - A header strip: route date + status badge + "Back" link to `/driver`.
     - If `route.status === "pending"`: render a notice "Route not started. Go back and tap 'Start route'." with a link to `/driver`. No stop actions available.
     - Else render the stop list.
     - Vertically stacked `<StopCard />` components, one per `stopView`, with `isCurrent={index === currentStopIndex}` prop.
     - Below the list: if all stops picked up, render `<CompleteRouteButton routeId={route.id} />` inline so the driver doesn't have to go back. Otherwise render a muted "{remaining} stop(s) remaining".
     - At the root of the page (client boundary), mount `<GpsSampler routeId={route.id} enabled={route.status === "active" && session.role === "driver"} />`. Admin-view sessions do NOT sample GPS (they're debugging, not in a vehicle).
- `/Users/abraham/lab-dispatch/app/driver/route/_components/StopCard.tsx` — client component. Props: `{ stopId: string; position: number; officeName: string; address?: OfficeAddress; urgency: PickupUrgency; sampleCount?: number; specialInstructions?: string; status: "pending" | "arrived" | "picked_up"; isCurrent: boolean; canCheckIn: boolean }`. Renders:
  - Container: `rounded-2xl border p-4` plus conditional styling — `isCurrent` adds `ring-2 ring-blue-500`; `status === "picked_up"` adds `opacity-60`.
  - Top row: position badge (`#1`, `#2`, ...) + urgency badge (color-coded: `routine` gray, `urgent` amber, `stat` red) + status pill (`Pending` / `Arrived` / `Picked up`).
  - Office name in bold, large (`text-xl font-semibold`).
  - Address block (street / city / state / zip) in smaller muted text.
  - `sampleCount` line if set: "Samples: N".
  - `specialInstructions` block if set, in a slight callout (`bg-amber-50 text-amber-900 rounded p-2 text-sm`) — drivers need to see instructions before tapping arrived.
  - "Open in Maps" link (`<a href={googleMapsSearchUrl(address)} target="_blank" rel="noopener">`) — always visible when `address` is present.
  - Action buttons (shown only when `canCheckIn === true`):
    - `"I've arrived"` — shown when `status === "pending"`. Large, full-width, `py-4 text-lg rounded-xl bg-blue-600 text-white`. Submits `<form action={arriveAtStopAction.bind(null, stopId)}>`.
    - `"Samples picked up"` — shown when `status === "arrived"`. Same styling. Submits `pickupStopAction.bind(null, stopId)`.
    - When `status === "picked_up"`, no buttons — just a muted "Completed" line.
  - Link to `/driver/route/${stopId}` ("Details →") at the bottom, small, for the detail page.
  - `canCheckIn` is derived by the server parent: true if session.role === "driver" AND route.status === "active" AND this card is the current one OR any earlier one hasn't been picked-up-yet … wait: drivers may arrive at stops out of order in practice. **Decision**: allow arrived/picked-up on ANY pending stop regardless of position. The `isCurrent` highlight is a hint, not a gate. This matches how SPEC describes stops-in-order without mandating strict sequencing. Update: `canCheckIn` is just `session.role === "driver" && route.status === "active"`.
- `/Users/abraham/lab-dispatch/app/driver/route/actions.ts`:
  - `arriveAtStopAction(stopId: string): Promise<void>` — bound. `requireDriverSession()`. Fetches `stop = getStop(stopId)`; throws if null. Fetches `route = getRoute(stop.routeId)`; throws if null OR `route.driverId !== session.userId` ("not your stop") OR `route.status !== "active"` ("route not active"). Calls `markStopArrived(stopId)` (storage enforces the "already arrived" guard). `revalidatePath("/driver/route")` + `revalidatePath("/driver/route/" + stopId)` + `revalidatePath("/driver")`.
  - `pickupStopAction(stopId: string): Promise<void>` — bound. Same preconditions as `arriveAtStopAction`. Calls `markStopPickedUp(stopId)` (storage enforces "not yet arrived" and "already picked up" guards). Same revalidations.
- `/Users/abraham/lab-dispatch/app/driver/route/actions.test.ts` — exhaustive (see Tests section).

### New: GPS sampler + record-location action
- `/Users/abraham/lab-dispatch/components/GpsSampler.tsx` — client component ("use client"). Props: `{ routeId: string; enabled: boolean; intervalMs?: number }`. `intervalMs` defaults to 60_000 (60 s). Behavior:
  - On mount (if `enabled`): check for `navigator.geolocation`. If unavailable or `enabled === false`, render a small muted "Location unavailable" note. The UI never blocks on geolocation.
  - Call `navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 })`. Store the returned `watchId` in a `useRef`.
  - On each position, store `{ lat, lng, ts: Date.now() }` in a `useRef` (not state — avoids re-renders).
  - Start a `setInterval(tick, intervalMs)`. `tick` reads the ref; if the latest position is fresh (`ts` within ~3× intervalMs), fires `recordLocationAction({ routeId, lat, lng })`. No-op if no position yet.
  - On error (PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT), flip to a "Location unavailable" fallback. Do NOT retry aggressively; a refresh re-mounts and re-requests.
  - On unmount: `navigator.geolocation.clearWatch(watchId)` + `clearInterval(intervalId)`.
  - Server-side rate-limit coalescing: the server action does not reject fast calls; it simply writes last-write-wins. We do NOT debounce client-side either — the 60 s interval is the natural debounce.
  - The component renders: either nothing (default, when sampling is quietly working) or a small `<p className="text-xs text-gray-400 text-center py-2">Location unavailable</p>` fallback. Does NOT render lat/lng to the driver — visible geo-coords are noisy.
  - Export as `{ GpsSampler }` from `components/GpsSampler.tsx`.
- `/Users/abraham/lab-dispatch/app/driver/actions.ts` (extends above) — add:
  - `recordLocationAction(input: { lat: number; lng: number }): Promise<void>` — no bound args; takes a plain object (Next 14+ server actions accept non-FormData objects when called from client code directly). `requireDriverSession()`. Derives `driverId = session.userId`. Calls `route = await getTodaysRouteForDriver(driverId)`. If `route === null` OR `route.status !== "active"`, return silently (no-op, no throw — the SPEC says "GPS sampling when driver is on an active route"; outside of that window, we just drop the ping). Calls `storage.recordDriverLocation({ driverId, routeId: route.id, lat, lng })`. NO `revalidatePath` — location writes don't invalidate driver-facing pages, and the dispatcher map page revalidates on its own refresh. Input validation: coerce to numbers; reject if either is not a finite number in range (`-90..90` for lat, `-180..180` for lng).
  - Note: `recordLocationAction` lives in the root driver actions file (`app/driver/actions.ts`) alongside `startRouteAction` / `completeRouteAction` because `GpsSampler` is mounted on `/driver/route` but the action is driver-scoped generally; no meaningful reason to split. OR it can live in `app/driver/route/actions.ts` — organizational nit. **Pick: `app/driver/actions.ts`** to keep the route/actions.ts file focused on stop check-ins.

### New: single-stop detail page
- `/Users/abraham/lab-dispatch/app/driver/route/[stopId]/page.tsx` — async server component. Flow:
  1. `session = requireDriverOrAdminSession()`.
  2. `stop = await storage.getStop(params.stopId)`; `notFound()` if null.
  3. `route = await storage.getRoute(stop.routeId)`; `notFound()` if null.
  4. If `session.role === "driver"` and `route.driverId !== session.userId`: `notFound()` (do not leak other drivers' stops).
  5. `driver = await storage.getDriver(route.driverId)`; `notFound()` if null (shouldn't happen, but defensive).
  6. `request = await storage.listPickupRequests().then(list => list.find(r => r.id === stop.pickupRequestId))` — OR add a `getPickupRequest(id)` method. Prefer the existing `listPickupRequests()`-and-filter approach to keep the interface surface minimal. (Known: this loads all pickup requests for one page render. At v1 scale, fine. Flagging as an open question.)
  7. `office = request?.officeId ? await storage.getOffice(request.officeId) : null`.
  8. Render a large-type `<DriverLayout title={office?.name ?? "Stop"} driverName={driver.fullName}>`:
     - Back link to `/driver/route`.
     - Position badge + urgency badge.
     - Full address (larger type than the card).
     - "Open in Maps" button.
     - `sampleCount`, `specialInstructions` displayed in big-readable blocks.
     - Arrived/Picked-up buttons (same wrappers as on the list page) when `canCheckIn`.
     - A muted note: "Map coming soon — use 'Open in Maps' to navigate" (placeholder for the Mapbox integration).

### Helpers shared by stop card + detail page
- `/Users/abraham/lab-dispatch/lib/office-links.ts` — tiny pure helper: `googleMapsSearchUrl(address: OfficeAddress): string`. Builds `https://www.google.com/maps/search/?api=1&query=` + URL-encoded "street, city, state, zip". If any address field is empty/undefined, concatenates what's present. Exported.
- `/Users/abraham/lab-dispatch/lib/office-links.test.ts` — cases:
  - Full address → correctly URL-encoded query.
  - Missing zip → works with what's present.
  - Empty address (all fields empty strings) → returns the base URL with an empty query (documented behavior; caller should guard before rendering).

### Modifications
- `/Users/abraham/lab-dispatch/interfaces/storage.ts` — add `NewDriverLocation` type + four new methods to `StorageService` (`getStop`, `markStopArrived`, `markStopPickedUp`, `recordDriverLocation`). Add matching `notConfigured()` stubs to `createRealStorageService()`.
- `/Users/abraham/lab-dispatch/mocks/storage.ts` — implement the four new methods. Reuse existing `state.stops` / `state.driverLocations`. No new state. (`seedDriverLocation` helper already exists and continues to work.)
- `/Users/abraham/lab-dispatch/mocks/storage.test.ts` — extend with cases for the four new methods (see Tests section).
- `/Users/abraham/lab-dispatch/BUILD_LOG.md` — append a dated entry summarizing the feature.
- `/Users/abraham/lab-dispatch/BLOCKERS.md` — no new top-level entries. If `[mapbox]` does not already note the driver detail page, append a one-line sub-bullet: "Driver stop detail page `/driver/route/[stopId]` currently renders address + 'Open in Maps' link; inline Mapbox route view lands with the Mapbox integration feature."

## Interfaces / contracts

### `interfaces/storage.ts` additions

```ts
import type { DriverLocation, Stop } from "@/lib/types";

export interface NewDriverLocation {
  driverId: string;
  routeId?: string;
  lat: number;   // -90..90
  lng: number;   // -180..180
  recordedAt?: string; // ISO8601; defaults to now
}

export interface StorageService {
  // ... existing methods from interface-layer and dispatcher-ui ...

  // Stops (additions)
  getStop(id: string): Promise<Stop | null>;
  // Returns null when the stop does not exist.

  markStopArrived(stopId: string): Promise<Stop>;
  // Sets arrivedAt = now if unset and returns the updated Stop.
  // Throws "stop <id> not found" on bad id.
  // Throws "stop <id> already arrived" when arrivedAt is already set.

  markStopPickedUp(stopId: string): Promise<Stop>;
  // Sets pickedUpAt = now if unset and returns the updated Stop.
  // Throws "stop <id> not found" on bad id.
  // Throws "stop <id> not yet arrived" when arrivedAt is unset (we enforce
  //   the arrived → picked-up ordering).
  // Throws "stop <id> already picked up" when pickedUpAt is already set.

  // Driver locations (additions)
  recordDriverLocation(input: NewDriverLocation): Promise<DriverLocation>;
  // Appends a row to driver_locations. `recordedAt` defaults to now when
  // omitted. Returns the inserted row. No throws on happy path; numeric
  // range validation is the caller's responsibility (the server action
  // does it), but the mock does NOT validate — it writes whatever it
  // gets. This mirrors how the real Postgres INSERT would behave (no CHECK
  // constraint in the current schema).
}
```

### `lib/require-driver.ts`

```ts
import type { SessionCookieValue } from "@/lib/session";

export function requireDriverSession(): SessionCookieValue;
// Strict driver-only. role === 'driver' → returns; anything else → redirect('/login').

export function requireDriverOrAdminSession(): SessionCookieValue;
// role === 'driver' OR role === 'admin' → returns; anything else → redirect('/login').
```

### `lib/today-route.ts`

```ts
import type { Route } from "@/lib/types";
export function getTodaysRouteForDriver(
  driverId: string,
  timeZone?: string, // defaults to "UTC"
): Promise<Route | null>;
```

### `lib/office-links.ts`

```ts
import type { OfficeAddress } from "@/lib/types";
export function googleMapsSearchUrl(address: OfficeAddress): string;
```

### Server actions

All driver server actions live under `app/driver/**`. All call `requireDriverSession()` at the top (STRICT driver only for mutations).

```ts
// app/driver/actions.ts
"use server";
export async function startRouteAction(routeId: string): Promise<void>;
export async function completeRouteAction(routeId: string): Promise<void>;
export async function recordLocationAction(
  input: { lat: number; lng: number },
): Promise<void>;

// app/driver/route/actions.ts
"use server";
export async function arriveAtStopAction(stopId: string): Promise<void>;
export async function pickupStopAction(stopId: string): Promise<void>;
```

### Routes / URL surface
No new HTTP API routes. Everything is App Router server components + server actions.

Pages:
- `/driver` — today summary + start/complete route
- `/driver/route` — full stop list + GPS sampler mount
- `/driver/route/[stopId]` — single-stop detail

### Role matrix

| Surface                          | driver | admin | dispatcher | anon |
|----------------------------------|--------|-------|------------|------|
| GET `/driver`                    | yes    | yes (needs `?driverId=`) | redirect | redirect |
| GET `/driver/route`              | yes    | yes (needs `?driverId=`) | redirect | redirect |
| GET `/driver/route/[stopId]`     | yes (own) | yes | redirect | redirect |
| `startRouteAction`               | yes (own route) | redirect | redirect | redirect |
| `completeRouteAction`            | yes (own route, all stops picked up) | redirect | redirect | redirect |
| `arriveAtStopAction`             | yes (own route, active) | redirect | redirect | redirect |
| `pickupStopAction`               | yes (own route, active, arrived) | redirect | redirect | redirect |
| `recordLocationAction`           | yes (no-op when no active route) | redirect | redirect | redirect |

Middleware already denies dispatcher/anon on `/driver/**`; these helpers are belt-and-suspenders.

## Implementation steps

1. **Verify prerequisites.** Grep `/Users/abraham/lab-dispatch/lib/auth-rules.ts` to confirm `/driver/**` permits `driver` + `admin` (per the auth-skeleton plan). If the current policy only allows `driver`, widen it to include `admin` in a one-line edit, and call it out in the commit. Flagged as a potential out-of-scope touch; keep it minimal.

2. **Extend `interfaces/storage.ts`.** Add `NewDriverLocation`; add `getStop`, `markStopArrived`, `markStopPickedUp`, `recordDriverLocation` signatures with the documented throw-behavior; add `notConfigured()` stubs in `createRealStorageService()`. Run `npm run typecheck` — expect nothing downstream to break yet.

3. **Extend mock storage.** Edit `/Users/abraham/lab-dispatch/mocks/storage.ts`:
   - `getStop(id)` → `state.stops.get(id) ?? null`.
   - `markStopArrived(stopId)` → look up; throw `"stop ${id} not found"` if missing; throw `"stop ${id} already arrived"` if `arrivedAt` is set; set `arrivedAt = nowIso()`; overwrite map entry; return.
   - `markStopPickedUp(stopId)` → look up; throw on missing; throw `"stop ${id} not yet arrived"` if `arrivedAt` unset; throw `"stop ${id} already picked up"` if `pickedUpAt` set; set `pickedUpAt = nowIso()`; overwrite; return.
   - `recordDriverLocation(input)` → build `DriverLocation` with a stringified sequence id (use a counter — e.g. `state.driverLocations.length + 1` as a string — to mirror `bigserial`); set `recordedAt = input.recordedAt ?? nowIso()`; `state.driverLocations.push(loc)`; return the appended row.

4. **Extend mock storage tests** (`mocks/storage.test.ts`) — see Tests section.

5. **`lib/today-route.ts` + test.** Implement; mock `getServices()` in the test with a local stub.

6. **`lib/office-links.ts` + test.** Implement; `encodeURIComponent` the parts.

7. **`lib/require-driver.ts` + test.** Implement the two exports. Mirror `require-dispatcher.test.ts` scaffold.

8. **Driver layout chrome.** Create `/Users/abraham/lab-dispatch/components/DriverLayout.tsx` + `/Users/abraham/lab-dispatch/app/driver/layout.tsx` (viewport export only; DriverLayout is used per-page). Verify the root `app/layout.tsx` isn't duplicating viewport meta.

9. **Replace driver root page.** Rewrite `/Users/abraham/lab-dispatch/app/driver/page.tsx` per the flow above. Create the two client children (`StartRouteButton`, `CompleteRouteButton`).

10. **Create driver actions.** `/Users/abraham/lab-dispatch/app/driver/actions.ts` — `startRouteAction`, `completeRouteAction`, `recordLocationAction`. All three start with `requireDriverSession()`. `completeRouteAction` fetches stops to verify all are picked up before calling `updateRouteStatus(..., "completed")`.

11. **Driver route list page.** `/Users/abraham/lab-dispatch/app/driver/route/page.tsx` + `_components/StopCard.tsx`.

12. **Driver route actions.** `/Users/abraham/lab-dispatch/app/driver/route/actions.ts` — `arriveAtStopAction`, `pickupStopAction`. Both validate ownership: session's `userId` must equal `route.driverId`, and `route.status === "active"`.

13. **GPS sampler.** Create `components/GpsSampler.tsx` per the contract above. Mount it at the bottom of `/driver/route/page.tsx`'s JSX.

14. **Stop detail page.** `/Users/abraham/lab-dispatch/app/driver/route/[stopId]/page.tsx`.

15. **Action tests.** Write `app/driver/actions.test.ts` and `app/driver/route/actions.test.ts`. Mock `next/cache`, `next/navigation`, `@/lib/require-driver`, and `@/lib/today-route` (for `recordLocationAction`). Exhaustive happy + sad + auth bail-out paths (see Tests section).

16. **BUILD_LOG + BLOCKERS.** Append entries.

17. **Verification gate.** Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. All green. Manual smoke (documented, not gated):
    - Sign in as the seeded driver account (check `mocks/auth.ts` for the seeded email; default per the auth-skeleton is `driver@test` / `test1234`).
    - Hit `/driver` from a narrow-width browser (iPhone emulation in DevTools, 390px wide).
    - With no seed data: see "No route assigned yet" empty state.
    - Seed a route + stops via a test harness or ad-hoc dev action (flagged as open question — there's no dispatcher-seeded data source unless the user already has one). Pragmatic path: use `/dispatcher` to create a route and assign stops, then switch back to the driver account.
    - Start route → redirected to `/driver/route` → stop cards render → current stop highlighted.
    - Tap "I've arrived" on the first stop → status updates to Arrived → "Samples picked up" button appears.
    - Tap "Samples picked up" → card dims → next card becomes current.
    - Repeat for all stops → "Complete route" button appears → tap → redirected to `/driver` with completed summary.
    - Check dispatcher `/dispatcher/map`: the driver's ping should appear (if geolocation was granted during the active route; on a laptop without real GPS, the browser will deny or return a rough city-level location — either is fine for smoke).
    - Document results in BUILD_LOG.

## Tests to write

### `lib/require-driver.test.ts`
Eight cases total (four per helper):
- `requireDriverSession`: driver → returns; admin → redirect; dispatcher → redirect; null → redirect.
- `requireDriverOrAdminSession`: driver → returns; admin → returns; dispatcher → redirect; null → redirect.

### `lib/today-route.test.ts`
- Returns the sole route for this driver on today's date (UTC).
- Returns null when the driver has zero routes.
- Returns null when the driver's only routes are on other dates.
- Returns the earliest-created when multiple exist (defensive).
- Respects a non-UTC `timeZone` arg (seed a route dated `2026-04-23`, set system time to `2026-04-22T23:30:00Z`; calling with `timeZone="Pacific/Auckland"` returns the route; calling with default `"UTC"` returns null).
Uses `vi.useFakeTimers()` + `vi.setSystemTime(...)` + mocks `getServices()` (or calls the mock storage directly with seeded routes — simpler).

### `lib/office-links.test.ts`
- Full address → URL-encoded query string with commas and spaces.
- Partial address (missing zip) → encodes what's present.
- Empty address (all empty strings) → base URL with empty `query=`.

### `mocks/storage.test.ts` (extended)
- **`getStop` happy** — seeds a stop, `getStop(id)` returns it.
- **`getStop` miss** — returns null on unknown id.
- **`markStopArrived` happy** — sets `arrivedAt` to a fresh ISO timestamp.
- **`markStopArrived` missing stop** — throws.
- **`markStopArrived` already arrived** — throws `/already arrived/`.
- **`markStopPickedUp` happy** — requires arrived first; sets `pickedUpAt`.
- **`markStopPickedUp` missing stop** — throws.
- **`markStopPickedUp` not arrived** — throws `/not yet arrived/`.
- **`markStopPickedUp` already picked up** — throws `/already picked up/`.
- **`recordDriverLocation` happy** — appends a row; returned row matches the seed; `listDriverLocations({ sinceMinutes: 1 })` sees it.
- **`recordDriverLocation` default recordedAt** — uses now when omitted (assert the returned `recordedAt` parses to a time within ±5 s of test start).
- **`recordDriverLocation` with explicit recordedAt** — preserves it verbatim.

### `app/driver/actions.test.ts`
For each action: happy path, one domain-error, auth-fail bail-out.
- **`startRouteAction` happy** — a pending route owned by the signed-in driver transitions to active; `redirect("/driver/route")` is called.
- **`startRouteAction` rejects wrong-driver** — route belongs to a different driverId → throws before calling `updateRouteStatus`.
- **`startRouteAction` rejects non-pending route** — active or completed → throws.
- **`startRouteAction` auth bail-out** — `requireDriverSession` throws → action throws before calling storage.
- **`completeRouteAction` happy** — active route, all stops `pickedUpAt` set → transitions to completed.
- **`completeRouteAction` rejects incomplete** — one stop missing `pickedUpAt` → throws `/pending stops/`.
- **`completeRouteAction` rejects wrong-driver** — throws.
- **`completeRouteAction` auth bail-out** — throws.
- **`recordLocationAction` happy** — driver with an active route → calls `recordDriverLocation` with correct driverId/routeId.
- **`recordLocationAction` no-op no-route** — driver with no route today → returns silently; no storage call.
- **`recordLocationAction` no-op inactive route** — pending/completed route → silent no-op.
- **`recordLocationAction` rejects invalid coords** — NaN/∞/out-of-range lat or lng → throws; no storage call.
- **`recordLocationAction` auth bail-out** — throws; no storage call.

### `app/driver/route/actions.test.ts`
- **`arriveAtStopAction` happy** — stop's route is active and owned → `markStopArrived` called.
- **`arriveAtStopAction` rejects wrong-driver** — stop belongs to another driver's route → throws before storage write.
- **`arriveAtStopAction` rejects inactive route** — pending or completed route → throws.
- **`arriveAtStopAction` rejects unknown stop** — `getStop` returns null → throws.
- **`arriveAtStopAction` already-arrived error surfaces** — mock storage throws `/already arrived/`; action propagates.
- **`arriveAtStopAction` auth bail-out** — throws.
- **`pickupStopAction` happy** — arrived stop transitions.
- **`pickupStopAction` rejects not-arrived** — storage throws `/not yet arrived/`; action propagates.
- **`pickupStopAction` rejects wrong-driver** — throws.
- **`pickupStopAction` rejects inactive route** — throws.
- **`pickupStopAction` auth bail-out** — throws.

### Explicitly NOT written in this feature
- **No `GpsSampler` component tests.** Rationale: the component's logic is `navigator.geolocation.watchPosition` + `setInterval` + a server-action call — the browser-API mocking overhead exceeds the load-bearing surface. The server-action path is tested exhaustively above. Documented in a file-top comment in `GpsSampler.tsx`.
- **No rendering tests for `StopCard`, `StartRouteButton`, `CompleteRouteButton`, `DriverLayout`, or any driver page.** Same rationale as dispatcher-ui/admin-ui: presentational glue with minimal load-bearing logic. Manual smoke covers it.
- **No end-to-end flow test** (sign-in → start → arrived → picked-up → complete). Requires Playwright infra not in the repo.

## External services touched
- **Storage** — wrapped by `interfaces/storage.ts`. This feature extends the interface with four methods; the real adapter (`createRealStorageService()`) gets `notConfigured()` stubs.
- **Auth** — read-only: pages call `getSession()` via `requireDriverSession` / `requireDriverOrAdminSession`. No new auth writes.
- **Browser geolocation** — `navigator.geolocation.watchPosition`. NOT wrapped by an interface because (a) it's a browser API, not a server service, and (b) it's confined to one client component (`GpsSampler.tsx`). If we ever need to server-side mock it, we'd introduce `interfaces/geolocation.ts` — overkill for v1.
- **Mapbox** — NOT called. The detail page renders a "Open in Maps" Google Maps deep link as a temporary navigation path; a future feature wires Mapbox GL JS.
- **SMS / Email / Anthropic** — NOT called.

## Open questions

1. **Admin impersonation pattern.** The plan has admin open `/driver?driverId=...` to view a specific driver's page. There's no admin-facing "pick a driver to impersonate-view" UI; admins either know the profileId or navigate from `/admin/drivers` (which would need a new "View driver day" link — not in this feature's scope). Recommendation: leave as-is for v1; the BUILD_LOG flags it as a follow-up for `admin-ui` extension.

2. **Pickup request lookup for the detail page.** `/driver/route/[stopId]` fetches `listPickupRequests()` and filters for one id. Cheaper to add a `getPickupRequest(id)` interface method. Recommendation: skip for this feature. At v1 scale (dozens of requests per day) the full scan is trivial. If a later feature (e.g. admin report) needs the method, add it then. Flagging so the builder doesn't silently add it.

3. **Geolocation in an iframe / insecure context.** If the dev/preview environment isn't HTTPS, `navigator.geolocation` returns `PERMISSION_DENIED` immediately. The fallback "Location unavailable" note is correct behavior, but manual smoke in dev must tolerate it. Vercel preview is HTTPS so production-like smoke works. Documented in the manual-smoke note.

4. **`unique (driver_id, route_date)` constraint.** `today-route.ts` assumes at most one route per driver per day. If `supabase/schema.sql` lacks this unique constraint, the app-layer invariant is enforced only by convention. Recommendation: add the constraint if missing (one-line schema edit in this feature). If adding it is out of scope for this feature (because the schema change needs a migration), open a BLOCKERS entry instead and let dispatcher-ui avoid creating duplicate routes. Grep during step 1 of implementation.

5. **Admin viewing the strict check-in actions.** Admin can OPEN `/driver/route` and see the arrive/pickup buttons, but the buttons submit to actions that reject admin sessions with a `redirect("/login")` — that means an admin who clicks one is kicked to the login page, which is a bad UX. Mitigation: render buttons in an inert read-only style for admin sessions (the `canCheckIn` flag already gates this). Confirm the flag is set correctly for admin sessions in `StopCard`.

6. **Recording location while the `/driver/route` tab is backgrounded.** `navigator.geolocation.watchPosition` pauses when the tab is backgrounded on most mobile browsers. The `setInterval` also suspends (or runs at reduced frequency). Result: pings stop when the driver switches to another app. SPEC accepts this for v1 (no background location). If product wants foreground-only language in the UI, add a small note like "Keep this page open to share your location". Recommendation: add the note on `/driver/route` under the stop list when `route.status === "active"` — low-cost, sets expectations.

7. **GPS sampler interval configurability.** Hard-coded 60 s per SPEC ("every 1–2 minutes"). If the dispatcher needs finer granularity during an urgent delivery, we'd need per-lab or per-route config. Out of scope for v1.

8. **Race on concurrent check-ins.** If the driver double-taps "I've arrived" fast, the browser may fire the server action twice. The storage mock's `markStopArrived` throws on the second attempt (already arrived) — good. Client UX: `useFormStatus` disables the button while pending; server-side throw is the safety net. No additional work needed.

9. **Stop ordering strictness.** The plan lets drivers arrive at any pending stop regardless of position (the `isCurrent` highlight is a hint, not a gate). If product expects strict ordering (can't skip stop 2), we'd need a server-side guard in `arriveAtStopAction` checking that all earlier stops are picked up. Flagging — product likely prefers flexibility.
