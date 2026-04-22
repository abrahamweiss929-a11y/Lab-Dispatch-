# Plan: Dispatcher UI — Requests Queue, Routes Assignment, Driver Location Snapshot

**Slug:** dispatcher-ui
**SPEC reference:** "Dispatcher (lab secretary) — desktop web portal. Live map of all drivers, today's pickup request queue, route assignment tools." under Account types; "Dispatcher live map + request queue + route assignment" under v1 features IN; "Unknown-sender handling" (flagged message review); "Live tracking" (driver location snapshot — real-time subscriptions deferred). Consumes the seam built by `interface-layer` (storage mock + real stub), the session/middleware protection established by `auth-skeleton` (middleware `/dispatcher` tree allows both `dispatcher` and `admin` per `lib/auth-rules.ts`), and the page-composition pattern established by `admin-ui` (`components/AdminLayout.tsx` + `components/AdminNavLink.tsx`).
**Status:** draft

## Goal
Give a signed-in dispatcher (or admin acting as one) a working, mock-backed UI to (1) triage incoming pickup requests for today, (2) create routes and assign requests as ordered stops to them, (3) see where each driver last was, and (4) review flagged inbound SMS/email messages and convert them into pickup requests when the AI couldn't parse them. Every mutation is a server action; every read goes through `getServices().storage`; the storage interface gains the minimum set of methods (`listRoutes`, `getRoute`, `createRoute`, `updateRouteStatus`, `listStops`, `assignRequestToRoute`, `removeStopFromRoute`, `reorderStops`, `listDriverLocations`, `listMessages`, `createRequestFromMessage`, `countDispatcherDashboard`, plus a `flaggedReason` parameter on `updatePickupRequestStatus`) to support the pages. Real Mapbox rendering and Supabase Realtime subscriptions stay deferred — this feature ends when a dispatcher can triage, route, and re-route a day's work end-to-end against the mock.

## Out of scope
- Real Supabase storage adapter. `createRealStorageService()` gains matching `notConfigured()` stubs for every new method; no live DB calls.
- Real Mapbox map rendering on `/dispatcher/map`. The page lists driver rows with their last lat/lng plus an on-page note "this becomes a real map when `MAPBOX_TOKEN` is wired." Deferred until Mapbox integration lands.
- Real-time updates. Every page is a static server component that re-renders on refresh (or after a server action's `revalidatePath`). No Supabase Realtime, no polling, no WebSocket. SPEC mentions GPS sampling every 1–2 minutes — that is a future driver-side concern; this feature consumes whatever locations happen to be in storage at read time.
- Automatic route optimization (SPEC v1 OUT).
- AI re-parsing of flagged messages. "Convert to request" creates a blank-ish `pending` pickup request that the dispatcher fills out; it does not re-invoke Claude. A separate future feature can re-queue messages for AI.
- Driver-initiated check-ins, GPS ingestion, or any `driver_locations` writes. This feature only READS `driver_locations`. The Driver UI feature will write them.
- ETA computation. `Stop.etaAt` is exposed on the type and schema but never set in this feature — a later feature (routing engine / driver view) will compute and patch.
- Inbound-webhook handlers for Twilio/Postmark. `messages` rows are seeded manually (via tests or an ad-hoc dev script) or land via a future "inbound ingestion" feature. This feature only reads and converts.
- Pagination / virtualized tables. Dispatcher scale is one day at a time; dozens of requests and routes. Simple tables suffice.
- Component-rendering tests for pages and client forms. Same rationale as `admin-ui`: load-bearing logic is in server actions and the storage mock, both of which are unit-tested. Manual smoke covers the UI glue. Revisit when E2E infra lands.
- Confirmation modals / fancy UI polish (we use `window.confirm()` where a destructive action needs a guard, matching `admin-ui`'s `DeleteDoctorButton` pattern).
- Dispatcher-initiated new driver / office / doctor CRUD. Dispatchers do not create those records in v1 — they assign pre-existing drivers and route to pre-existing offices. Admin UI owns CRUD; dispatchers use read-only dropdowns.
- Drag-and-drop stop reordering. V1 uses up/down buttons that call a `reorderStops` server action. Drag-and-drop is a later UI polish pass.
- A generic "unassign from route" flow separate from `removeStopFromRoute` (the latter is sufficient — removing a stop re-opens the underlying pickup request for reassignment; see step 10).
- Historical routes / archive view. The routes page defaults to today only. A future feature can add date-range filtering; this feature's storage `listRoutes({ date?, driverId?, status? })` filter surface exists so the future feature doesn't require another storage change.

## Files to create or modify

### New: shared dispatcher chrome
- `/Users/abraham/lab-dispatch/components/DispatcherLayout.tsx` — server component mirroring `AdminLayout.tsx`. Two-column layout with `<aside>` sidebar + `<main>` content. Nav links: Dashboard (`/dispatcher`), Requests (`/dispatcher/requests`), Routes (`/dispatcher/routes`), Map (`/dispatcher/map`), Messages (`/dispatcher/messages`), Log out (`/logout`). Sidebar sub-label reads "Dispatcher". Accepts `{ title?: string; children: ReactNode }`.
- `/Users/abraham/lab-dispatch/components/DispatcherNavLink.tsx` — client component for sidebar links that highlights the active route via `usePathname()`. Same `startsWith`-based match as `AdminNavLink.tsx`, extracted for cohesion (dispatcher + admin share no styling state, so two files instead of one generalized component — keeps each layout's nav simple to read).
- `/Users/abraham/lab-dispatch/lib/require-dispatcher.ts` — helper `requireDispatcherSession(): SessionCookieValue`. Calls `getSession()`; if the session is null OR the role is neither `"dispatcher"` nor `"admin"`, calls `redirect("/login")` from `next/navigation`. Returns the non-null session. Admins can act as dispatchers (for emergency coverage / dev smoke); the middleware at `/dispatcher/**` already allows both admins and dispatchers via `evaluateAccess` (see `lib/auth-rules.ts` line 85–92 — admins are allowed anywhere; dispatchers are allowed under `/dispatcher`). This helper is the page-level belt-and-suspenders.
- `/Users/abraham/lab-dispatch/lib/require-dispatcher.test.ts` — unit tests mirroring `require-admin.test.ts`: admin session → returns; dispatcher session → returns; driver session → redirect to `/login`; null session → redirect. Uses `vi.mock('@/lib/session', ...)` and `vi.mock('next/navigation', ...)`.

### New: date + formatting helpers
- `/Users/abraham/lab-dispatch/lib/dates.ts` — pure helpers:
  - `todayIso(timeZone?: string): string` — returns "YYYY-MM-DD" for the given IANA timezone (default `"UTC"`). Uses `Intl.DateTimeFormat(timeZone, { year, month, day })` with `"en-CA"` locale (en-CA already formats as ISO `YYYY-MM-DD`, avoiding a manual part-assembly). Accepts an optional second `now?: Date` argument for test determinism (defaults to `new Date()`).
  - `formatShortDateTime(ts: string, timeZone?: string): string` — parses an ISO timestamp and renders "MMM d, h:mm a" (e.g., `"Apr 22, 2:07 PM"`) via `Intl.DateTimeFormat`. Returns the literal `"—"` on an empty/invalid input (no throw; callers render unknown timestamps as em-dash without having to guard).
  - `formatDateIsoToShort(dateIso: string): string` — turns "YYYY-MM-DD" into "MMM d" (no year) for compact row display. Returns `"—"` on empty/invalid.
  Implementation note: `timeZone` defaults to `"UTC"` because the app has no per-lab timezone setting yet (SPEC: "Timezones handled per-lab" — future work, not this feature). When per-lab TZ lands, pass it in from the session / lab record. Document this in a file-top comment.
- `/Users/abraham/lab-dispatch/lib/dates.test.ts` — cases:
  - `todayIso("UTC", new Date("2026-04-22T23:30:00Z"))` → `"2026-04-22"`.
  - `todayIso("America/New_York", new Date("2026-04-22T23:30:00Z"))` → `"2026-04-22"` (still 19:30 ET, same day).
  - `todayIso("America/New_York", new Date("2026-04-23T03:30:00Z"))` → `"2026-04-22"` (23:30 ET previous day).
  - `todayIso("Pacific/Auckland", new Date("2026-04-22T23:30:00Z"))` → `"2026-04-23"`.
  - `formatShortDateTime("")` → `"—"`; `formatShortDateTime("not-a-date")` → `"—"`.
  - `formatShortDateTime("2026-04-22T14:07:00Z", "UTC")` → matches `/Apr 22, 2:07\sPM/` (case-insensitive; allow `/s` for NBSP because some ICU builds insert U+202F between the time and AM/PM marker).
  - `formatDateIsoToShort("2026-04-22")` → matches `/Apr 22/`.
  - `formatDateIsoToShort("")` → `"—"`.

### New: storage interface additions
See the "Interfaces / contracts" section for full signatures. At a glance:
- `listRoutes(filter?: { date?: string; driverId?: string; status?: RouteStatus }): Promise<Route[]>`
- `getRoute(id: string): Promise<Route | null>`
- `createRoute(input: { driverId: string; routeDate: string }): Promise<Route>`
- `updateRouteStatus(id: string, status: RouteStatus): Promise<Route>`
- `listStops(routeId: string): Promise<Stop[]>` (ordered by `position` ascending)
- `assignRequestToRoute(routeId: string, pickupRequestId: string, position?: number): Promise<Stop>`
- `removeStopFromRoute(stopId: string): Promise<void>`
- `reorderStops(routeId: string, orderedStopIds: string[]): Promise<void>`
- `listDriverLocations(filter?: { sinceMinutes?: number }): Promise<DriverLocation[]>` — latest location per driver within the window (default 15 minutes).
- `listMessages(filter?: { flagged?: boolean }): Promise<Message[]>`
- `createRequestFromMessage(messageId: string): Promise<PickupRequest>`
- `countDispatcherDashboard(dateIso?: string): Promise<{ pendingRequests: number; todayStops: number; activeRoutes: number; flaggedMessages: number }>`
- `updatePickupRequestStatus(id: string, status: PickupStatus, flaggedReason?: string): Promise<PickupRequest>` — extends the existing signature with an optional third arg that is written to `flaggedReason` when present (and cleared to `undefined` when status transitions away from `"flagged"`).

### Modifications: core types (reconcile `lib/types.ts` with `supabase/schema.sql`)

`lib/types.ts` currently has a draft `Route`/`Stop`/`RouteStatus` shape that does not match `supabase/schema.sql`. This feature reconciles them because dispatcher pages need Route/Stop/DriverLocation/Message types to be real and schema-aligned.

- **`RouteStatus`** — narrow from `'draft' | 'assigned' | 'active' | 'completed'` to `'pending' | 'active' | 'completed'` to match `public.route_status` in `supabase/schema.sql`. Rationale: the schema is the source of truth; `'draft'` / `'assigned'` are not in the enum. A newly created route starts in `'pending'` (the schema default). Grep after the edit: `grep -rn '"draft"\|"assigned".*RouteStatus\|RouteStatus' app lib interfaces mocks` — update any literal that used the dropped values. (At time of writing, no code references `RouteStatus` values yet — routes are unused. Edit is safe.)
- **`Route`** — change to match schema: `{ id, driverId, routeDate, status, startedAt?, completedAt?, createdAt }`. Remove embedded `stops: Stop[]` (stops are fetched separately via `listStops(routeId)`; embedding does not match the normalized schema and forces every `Route` read to hydrate stops, which is wrong for the list page). `routeDate` is a "YYYY-MM-DD" string matching the `date` column type.
- **`Stop`** — change to match schema: `{ id, routeId, pickupRequestId, position, etaAt?, arrivedAt?, pickedUpAt?, createdAt }`. Rename `sequence` → `position` (the SQL column is `position`). Drop `officeId` — the schema does not have `stops.office_id`; callers join through `pickup_request → office` when they need the office. The dispatcher-routes-detail page hydrates office info by fetching the pickup request + its office on the server.
- **`DriverLocation` (new)** — `{ id: string; driverId: string; routeId?: string; lat: number; lng: number; recordedAt: string }`. Matches `public.driver_locations`. Note: the SQL uses `bigserial` for `id`; the mock exposes it as `string` (stringified serial) to stay consistent with every other id in the app. Document in the type's JSDoc.
- **`Message` (new)** — `{ id: string; channel: PickupChannel; fromIdentifier: string; subject?: string; body: string; receivedAt: string; pickupRequestId?: string }`. `channel` reuses `PickupChannel` (which maps to `public.request_channel`). The schema's `channel` enum is `request_channel`, shared with pickup requests — same enum, reused. `"web"` and `"manual"` in the enum are not expected to appear on Messages (web-form submits create pickup_requests directly, not messages), but the type-level union matches the SQL enum anyway. The dispatcher messages page filters out `"web"` / `"manual"` channels at the UI layer if the filter "flagged only" is on (which is the common case). Simpler: store exactly the SQL shape and let the UI decide.

(Do NOT alter `PickupRequest`, `Office`, `Driver`, `Doctor`, or enum values beyond `RouteStatus` — this is a minimum-necessary reconciliation.)

### New: dispatcher dashboard
- `/Users/abraham/lab-dispatch/app/dispatcher/page.tsx` — REPLACE the current placeholder. Async server component. `requireDispatcherSession()`, then `countDispatcherDashboard(todayIso())`. Renders four count cards inside `<DispatcherLayout title="Dashboard">`:
  - "Pending requests" → link to `/dispatcher/requests`.
  - "Today's stops" → link to `/dispatcher/routes`.
  - "Active routes" → link to `/dispatcher/routes?status=active` (the query-param filter is honored by the routes list page; see below).
  - "Flagged messages" → link to `/dispatcher/messages?filter=flagged`.
  Each card is a plain Tailwind block (label + big number).

### New: requests queue
- `/Users/abraham/lab-dispatch/app/dispatcher/requests/page.tsx` — server component. Accepts `searchParams: { filter?: "pending" | "flagged" | "all" }` (default `"pending"`). `requireDispatcherSession()`, then:
  - `listPickupRequests()` — fetches all; filter client-side on `createdAt` being today (compare against `todayIso()`). (Alternative considered: pass the filter down into `listPickupRequests`. Rejected for v1 because the filter semantics are "today's rows" which is trivial on the server-component side and dozens-of-rows scale. If list sizes grow, add a `listPickupRequests({ createdAtDate })` overload in a later feature.)
  - Within "today", further filter by tab: `pending` → `status === "pending"`, `flagged` → `status === "flagged"`, `all` → no status filter.
  - `listOffices()` in parallel for the "from" column (office name).
  - `listRoutes({ date: todayIso() })` in parallel for the "Assign to route" dropdown.
  - Renders a filter-tab bar (three `<Link>` tags, active one styled differently) + a table inside `<DispatcherLayout title="Today's requests">`.
  - Table columns: Created (via `formatShortDateTime`), Channel, From (office name if `officeId` resolves, else `sourceIdentifier` if set, else `"Unknown"`), Urgency, Samples (`sampleCount ?? "—"`), Status, Actions.
  - Actions cell renders three inline client children (all wrapping server actions):
    - `<AssignToRouteSelect requestId={req.id} routes={todaysRoutes} />` — a `<select>` with each option being "Driver name · route status" and a submit button. On submit, calls `assignRequestToRouteAction` (bound).
    - `<FlagForReviewButton requestId={req.id} />` — shown only when `status !== "flagged"`; prompts for a reason via `window.prompt()` then submits `flagRequestAction` (bound).
    - `<MarkResolvedButton requestId={req.id} />` — shown only when `status !== "completed"`; submits `markResolvedAction` (bound). Uses `window.confirm()`.
  - Above the table: a "New manual request" link to `/dispatcher/requests/new`.
- `/Users/abraham/lab-dispatch/app/dispatcher/requests/_components/AssignToRouteSelect.tsx` — client component. Receives `{ requestId: string; routes: Array<{ id: string; label: string }> }`. Renders a `<form action={assignRequestToRouteAction.bind(null, requestId)}>` with a `<select name="routeId">` + a submit button. Empty routes list → renders "No routes today" disabled text with a link to `/dispatcher/routes/new`.
- `/Users/abraham/lab-dispatch/app/dispatcher/requests/_components/FlagForReviewButton.tsx` — client wrapper; `onSubmit` calls `window.prompt("Why flag this request?")`; if the prompt returns a non-empty string, stuffs it into a hidden input and lets the form submit.
- `/Users/abraham/lab-dispatch/app/dispatcher/requests/_components/MarkResolvedButton.tsx` — client wrapper; `onSubmit` calls `window.confirm("Mark this request completed?")`.
- `/Users/abraham/lab-dispatch/app/dispatcher/requests/new/page.tsx` — server wrapper. Fetches `listOffices()` (active only). Renders `<NewManualRequestForm offices={...} />` inside `<DispatcherLayout title="New manual request">`.
- `/Users/abraham/lab-dispatch/app/dispatcher/requests/new/_components/NewManualRequestForm.tsx` — client form. Fields: `officeId` (required, `<select>`), `urgency` (required, `<select>` of `routine` / `urgent` / `stat`, default `routine`), `sampleCount` (optional number), `specialInstructions` (optional textarea) mapped to the pickup request's `specialInstructions` field. Uses `useFormState(createManualRequestAction, INITIAL_ADMIN_FORM_STATE)` (reusing the `AdminFormState` / `INITIAL_ADMIN_FORM_STATE` surface from `lib/admin-form.ts` — rename justification: the name "admin-form" is misleading now that dispatchers use it. This feature does NOT rename the file; flagged as an open question).
- `/Users/abraham/lab-dispatch/app/dispatcher/requests/actions.ts`:
  - `assignRequestToRouteAction(requestId: string, formData: FormData): Promise<void>` — bound with `requestId`. Reads `routeId` from form. Calls `requireDispatcherSession()`, then `assignRequestToRoute(routeId, requestId)`. Side effects: storage's `assignRequestToRoute` also flips the pickup request's status to `"assigned"` (see storage contract below). `revalidatePath("/dispatcher/requests")` and `revalidatePath("/dispatcher/routes/" + routeId)`. No redirect — stays on the requests page.
  - `flagRequestAction(requestId: string, formData: FormData): Promise<void>` — bound. Reads `reason` from form (required, non-empty). Calls `updatePickupRequestStatus(requestId, "flagged", reason)`. `revalidatePath("/dispatcher/requests")`. No redirect.
  - `markResolvedAction(requestId: string): Promise<void>` — bound. Calls `updatePickupRequestStatus(requestId, "completed")`. `revalidatePath("/dispatcher/requests")`. No redirect.
  - `createManualRequestAction(prev, formData)` — validates, calls `createPickupRequest({ channel: "manual", officeId, urgency, sampleCount?, specialInstructions?, status: "pending" })`. `revalidatePath("/dispatcher/requests")` + `redirect("/dispatcher/requests")`.
- `/Users/abraham/lab-dispatch/app/dispatcher/requests/actions.test.ts` — unit tests (happy + auth-fail). Mocks `next/cache`, `next/navigation`, `@/lib/require-dispatcher`. Cases:
  - `assignRequestToRouteAction` links request → route and sets request status to `"assigned"`.
  - `assignRequestToRouteAction` bails out on auth failure (mock `requireDispatcherSessionMock.mockImplementationOnce` to throw) before touching storage.
  - `flagRequestAction` sets status `"flagged"` + stores `flaggedReason`.
  - `flagRequestAction` rejects missing/empty reason (no storage call).
  - `markResolvedAction` sets status `"completed"`.
  - `createManualRequestAction` happy path: creates a `pending`, `manual`-channel request.
  - `createManualRequestAction` rejects unknown officeId.
  - `createManualRequestAction` bails out on auth failure.

### New: routes list + create + detail
- `/Users/abraham/lab-dispatch/app/dispatcher/routes/page.tsx` — server component. Accepts `searchParams: { status?: RouteStatus }`. `requireDispatcherSession()`, then `listRoutes({ date: todayIso(), status })` + `listDrivers()` (for name resolution) in parallel. Renders table: Driver (resolved from `drivers` by `driverId`), Stop count (from `listStops(route.id)` — fetch per row; v1 scale is fine — OR add a `getRoute` variant that returns the count; the latter is over-engineering for dozens of routes), Status, Open (link to `/dispatcher/routes/${id}`). Above table: "New route" link to `/dispatcher/routes/new`. Status filter tabs (All / Pending / Active / Completed) render as `<Link>` tags that set `?status=...`.
  - Stop count note: fetch all stops for the day in one batch via `listStops` would need a `listStops({ date })` overload we do not need elsewhere. Instead, the page does a `Promise.all(routes.map(r => listStops(r.id).then(s => s.length)))` — bounded by route count per day (realistically < 10). Document this as a known N+1 that is acceptable at v1 scale and will collapse to a single join in the real Supabase adapter. (Open question: should `listRoutes` return stop count inline? Flagging.)
- `/Users/abraham/lab-dispatch/app/dispatcher/routes/new/page.tsx` — server wrapper. Fetches `listDrivers()` filtered to `active === true`. Renders `<NewRouteForm drivers={activeDrivers} defaultDate={todayIso()} />` inside `<DispatcherLayout title="New route">`.
- `/Users/abraham/lab-dispatch/app/dispatcher/routes/new/_components/NewRouteForm.tsx` — client form. Fields: `driverId` (required, `<select>`), `routeDate` (required, `type="date"`, default = `defaultDate` prop). Uses `useFormState(createRouteAction, INITIAL_ADMIN_FORM_STATE)`.
- `/Users/abraham/lab-dispatch/app/dispatcher/routes/[id]/page.tsx` — server component. `requireDispatcherSession()`, then:
  - `getRoute(params.id)` → `notFound()` if null.
  - `listStops(route.id)` (ordered by `position`).
  - For each stop, fetch its pickup request + that request's office via `Promise.all` on `listPickupRequests()` once (filter client-side) + `listOffices()` once (build Map). Avoid N+1 fetches.
  - `listPickupRequests({ status: "pending" })` for the "unassigned" side-pane.
  - `listDrivers()` for displaying the route's driver name.
  - Renders: route header (driver name + date + status + action buttons to transition status), stops table with up/down buttons + remove button, and a side-pane of `pending` requests (today only, filtered client-side) with "Add to this route" buttons.
- `/Users/abraham/lab-dispatch/app/dispatcher/routes/[id]/_components/StopRow.tsx` — client component. Props: `{ stopId; pickupRequestId; officeName; position; totalStops; canMoveUp; canMoveDown }`. Renders a row with three `<form>` tags: "Up" (action: `moveStopUpAction.bind(null, routeId, stopId)`), "Down" (similar), "Remove" (wrapped in `window.confirm`).
- `/Users/abraham/lab-dispatch/app/dispatcher/routes/[id]/_components/AddStopForm.tsx` — client component; a small `<form>` with a hidden `pickupRequestId` input and a submit button "Add to this route". Reused once per pending-request row.
- `/Users/abraham/lab-dispatch/app/dispatcher/routes/[id]/_components/RouteStatusControls.tsx` — client component rendering three submit buttons ("Start route" / "Complete route" / "Reset to pending") depending on current status. Each button wraps a server action.
- `/Users/abraham/lab-dispatch/app/dispatcher/routes/actions.ts`:
  - `createRouteAction(prev, formData)` — validates `driverId` (non-empty + `getDriver(driverId)` returns non-null + `driver.active === true`) and `routeDate` (matches `/^\d{4}-\d{2}-\d{2}$/`). Calls `createRoute({ driverId, routeDate })`. `revalidatePath("/dispatcher/routes")` + `redirect("/dispatcher/routes/" + created.id)`.
  - `addStopToRouteAction(routeId: string, formData: FormData)` — bound. Reads `pickupRequestId`. Calls `assignRequestToRoute(routeId, pickupRequestId)` (position omitted → appended). `revalidatePath("/dispatcher/routes/" + routeId)`. No redirect.
  - `removeStopAction(routeId: string, stopId: string)` — bound. Calls `removeStopFromRoute(stopId)`. Storage side effect: the removed stop's pickup request flips back to `"pending"` status (see storage contract). `revalidatePath("/dispatcher/routes/" + routeId)` + `revalidatePath("/dispatcher/requests")`.
  - `moveStopUpAction(routeId: string, stopId: string)` / `moveStopDownAction(routeId: string, stopId: string)` — bound. Read current order via `listStops(routeId)`, swap the target stop with its neighbor, call `reorderStops(routeId, newOrderIds)`. `revalidatePath("/dispatcher/routes/" + routeId)`.
  - `startRouteAction(routeId: string)` — bound. `updateRouteStatus(routeId, "active")`. `revalidatePath("/dispatcher/routes/" + routeId)`.
  - `completeRouteAction(routeId: string)` — bound. `updateRouteStatus(routeId, "completed")`.
  - `resetRouteAction(routeId: string)` — bound. `updateRouteStatus(routeId, "pending")`. (For dispatcher-triggered rollback if they started a route by mistake.)
- `/Users/abraham/lab-dispatch/app/dispatcher/routes/actions.test.ts` — unit tests:
  - `createRouteAction` happy path creates + redirects.
  - `createRouteAction` rejects missing driverId, inactive driver, malformed date.
  - `addStopToRouteAction` appends a stop at the next position; assigning an already-assigned request throws (storage responsibility; action surfaces it).
  - `removeStopAction` removes stop + reopens the pickup request to `"pending"`.
  - `moveStopUpAction` swaps positions with the prior stop; is a no-op when the stop is already at position 1.
  - `moveStopDownAction` is a no-op at the tail.
  - `startRouteAction` / `completeRouteAction` / `resetRouteAction` transition statuses.
  - Each action bails out on auth failure before touching storage.

### New: driver location snapshot page
- `/Users/abraham/lab-dispatch/app/dispatcher/map/page.tsx` — server component. `requireDispatcherSession()`, then `listDriverLocations({ sinceMinutes: 15 })` + `listDrivers()` in parallel. Zips locations to drivers by `driverId`. Renders:
  - A prominent on-page note in an `<aside>` / callout block: "This becomes a real map when `MAPBOX_TOKEN` is wired. For now, it shows the last-known location of every driver who pinged in the past 15 minutes."
  - A table: Driver name, Recorded at (via `formatShortDateTime`), Lat (6 decimal places), Lng (6 decimal places), On route? (yes if `routeId` present — link to `/dispatcher/routes/${routeId}`).
  - Drivers with no recent ping appear below the table in a muted "Not reporting" list. This requires joining `listDrivers()` (all) against the location set to surface the absentees.

### New: messages log
- `/Users/abraham/lab-dispatch/app/dispatcher/messages/page.tsx` — server component. Accepts `searchParams: { filter?: "flagged" | "all" }` (default `"all"`). `requireDispatcherSession()`, then `listMessages({ flagged: filter === "flagged" ? true : undefined })`. Renders filter-tab bar (Flagged only / All) + a table inside `<DispatcherLayout title="Inbound messages">`. Columns: Received (via `formatShortDateTime`), Channel, From, Subject (if any; for SMS this is blank), Body (truncated to 140 chars with `…`), Linked request? (if `pickupRequestId` → "Yes, #" + short id, linking to the request in the queue; else "—"), Actions.
  - Actions: `<ConvertToRequestButton messageId={msg.id} />` — shown only when `pickupRequestId` is unset. Submits `convertMessageToRequestAction`.
- `/Users/abraham/lab-dispatch/app/dispatcher/messages/_components/ConvertToRequestButton.tsx` — client wrapper with `window.confirm("Create a pending pickup request from this message?")` guard.
- `/Users/abraham/lab-dispatch/app/dispatcher/messages/actions.ts`:
  - `convertMessageToRequestAction(messageId: string)` — bound. Calls `requireDispatcherSession()`, then `createRequestFromMessage(messageId)`. `revalidatePath("/dispatcher/messages")` + `revalidatePath("/dispatcher/requests")`. No redirect.
- `/Users/abraham/lab-dispatch/app/dispatcher/messages/actions.test.ts` — unit tests:
  - Happy path: converts a message → new pending request exists + message's `pickupRequestId` is set.
  - Bails out on auth failure.
  - Throws on unknown messageId.

### Modifications
- `/Users/abraham/lab-dispatch/lib/types.ts` — reconcile `Route`, `Stop`, `RouteStatus`; add `DriverLocation`, `Message`. (See "Modifications: core types" above for exact changes.)
- `/Users/abraham/lab-dispatch/interfaces/storage.ts` — add the new methods; change `updatePickupRequestStatus` signature to add optional `flaggedReason?: string`; add new input types (`NewRoute`, `RouteFilter`, `DriverLocationFilter`, `MessagesFilter`, `DispatcherDashboardCounts`); add `createRealStorageService()` stubs for every new method.
- `/Users/abraham/lab-dispatch/interfaces/index.ts` — re-export new types if it re-exports from `interfaces/storage.ts` (check the file during implementation; add only what's missing).
- `/Users/abraham/lab-dispatch/mocks/storage.ts` — add internal state maps for `routes`, `stops`, `driverLocations`, `messages`; implement every new method; extend `updatePickupRequestStatus` to accept and store `flaggedReason`; update `resetStorageMock()` to clear the new maps; add optional test helpers `seedRoute`, `seedStop`, `seedDriverLocation`, `seedMessage` for test setup (exported like the existing `getDriverAccount` test helper — NOT part of the interface).
- `/Users/abraham/lab-dispatch/mocks/storage.test.ts` — extend with cases for every new method (see Tests section).
- `/Users/abraham/lab-dispatch/BUILD_LOG.md` — append a dated entry.
- `/Users/abraham/lab-dispatch/BLOCKERS.md` — no new top-level entries. The existing `[supabase]` entry is already load-bearing; if it doesn't already mention Realtime, append a one-line sub-bullet under "Workaround in place": "Dispatcher UI reads `driver_locations` as a static snapshot; real Supabase Realtime subscription wires in a future feature." (If the entry already notes this, no edit.) Separately, add a new `[mapbox]` entry if one does not exist: "Dispatcher map page lists driver rows instead of rendering a real map. Unblocks when `MAPBOX_TOKEN` is set and the Mapbox GL JS client is integrated. See `/dispatcher/map` on-page note."

## Interfaces / contracts

### `interfaces/storage.ts` additions

```ts
import type {
  Route,
  RouteStatus,
  Stop,
  DriverLocation,
  Message,
  PickupRequest,
  PickupStatus,
} from "@/lib/types";

export interface ListRoutesFilter {
  date?: string;          // "YYYY-MM-DD"
  driverId?: string;
  status?: RouteStatus;
}

export interface ListDriverLocationsFilter {
  sinceMinutes?: number;  // default 15
}

export interface ListMessagesFilter {
  flagged?: boolean;      // true → messages whose `pickupRequestId` points at a `flagged` request OR that lack a `pickupRequestId`
}

export interface NewRoute {
  driverId: string;
  routeDate: string;      // "YYYY-MM-DD"
}

export interface DispatcherDashboardCounts {
  pendingRequests: number;  // pickup_requests.status = 'pending' (any date)
  todayStops: number;       // stops on routes whose route_date = today
  activeRoutes: number;     // routes.status = 'active'
  flaggedMessages: number;  // messages linked to flagged requests OR orphan messages
}

export interface StorageService {
  // ... existing methods ...

  // Pickup requests
  updatePickupRequestStatus(
    id: string,
    status: PickupStatus,
    flaggedReason?: string,  // written when present; cleared when status != 'flagged'
  ): Promise<PickupRequest>;

  // Routes
  listRoutes(filter?: ListRoutesFilter): Promise<Route[]>;
  getRoute(id: string): Promise<Route | null>;
  createRoute(input: NewRoute): Promise<Route>;  // status defaults to 'pending'
  updateRouteStatus(id: string, status: RouteStatus): Promise<Route>;
  // When transitioning to 'active', sets startedAt = now if unset.
  // When transitioning to 'completed', sets completedAt = now if unset.
  // When transitioning back to 'pending', clears startedAt AND completedAt.

  // Stops
  listStops(routeId: string): Promise<Stop[]>;  // ordered by position asc
  assignRequestToRoute(
    routeId: string,
    pickupRequestId: string,
    position?: number,  // defaults to max(existing positions) + 1, starting at 1
  ): Promise<Stop>;
  // Side effects:
  //   1. Inserts a stop row.
  //   2. Patches the pickup request's status to 'assigned'.
  //   3. Throws "route <id> not found" / "pickup request <id> not found" on bad ids.
  //   4. Throws "pickup request already assigned" if a stop for this request already exists anywhere.
  removeStopFromRoute(stopId: string): Promise<void>;
  // Side effects:
  //   1. Deletes the stop row.
  //   2. Re-numbers remaining stops on that route to be 1..N contiguous.
  //   3. Patches the underlying pickup request back to status 'pending'.
  //   4. Throws "stop <id> not found" on bad id.
  reorderStops(routeId: string, orderedStopIds: string[]): Promise<void>;
  // Rewrites position = 1..N in the given order. Throws if:
  //   - routeId is unknown.
  //   - orderedStopIds.length !== current stops count.
  //   - any id in orderedStopIds is missing from the route.
  //   - any stop id belongs to a different route.

  // Driver locations
  listDriverLocations(
    filter?: ListDriverLocationsFilter,
  ): Promise<DriverLocation[]>;
  // Returns AT MOST one row per driver — the most recent location per driver
  // whose recordedAt is within `sinceMinutes` of now (default 15).

  // Messages
  listMessages(filter?: ListMessagesFilter): Promise<Message[]>;
  // When filter.flagged === true, returns messages whose pickupRequestId is
  // unset (orphan / unknown sender) OR points at a pickup_request with
  // status = 'flagged'. When flagged is undefined/false, returns all messages.
  createRequestFromMessage(messageId: string): Promise<PickupRequest>;
  // Creates a new pickup_request:
  //   - channel = message.channel
  //   - officeId = null (dispatcher fills in later)
  //   - sourceIdentifier = message.fromIdentifier
  //   - rawMessage = message.body
  //   - urgency = 'routine' (default)
  //   - status = 'pending'
  // Then sets message.pickupRequestId = new request's id.
  // Throws "message <id> not found" on bad id, or "message already linked" if
  // message.pickupRequestId is already set.

  // Dashboard
  countDispatcherDashboard(dateIso?: string): Promise<DispatcherDashboardCounts>;
  // dateIso (YYYY-MM-DD) filters todayStops; defaults to UTC today.
}
```

#### PickupRequest `officeId` nullability
The type `PickupRequest.officeId` is currently `string` (non-nullable). The schema says `office_id uuid references public.offices(id) on delete set null` — nullable at the DB layer. `createRequestFromMessage` needs to produce a request with no office (unknown sender). Two options:

- **(A)** Change `PickupRequest.officeId` to `string | undefined` and thread the optional through the type + all consumers. Truest to schema.
- **(B)** Keep it non-nullable and use a sentinel empty string `""` for orphans. Ugly but minimal-diff.

**Decision: (A).** The schema-truth win outweighs the one-line consumer audit. Grep after the edit: `grep -rn 'officeId' app lib mocks interfaces` — confirm every consumer either renders safely on undefined or has a guard. Known call sites currently: `NewPickupRequest` shape (drop `officeId` from required, add to optional), `mocks/storage.ts` `createPickupRequest` (no change needed; it just forwards), `app/dispatcher/requests/page.tsx` (new; render "Unknown" if undefined). This is included in the scope of this feature.

### `lib/dates.ts`

```ts
export function todayIso(timeZone?: string, now?: Date): string;
export function formatShortDateTime(ts: string, timeZone?: string): string;
export function formatDateIsoToShort(dateIso: string): string;
```

### `lib/require-dispatcher.ts`

```ts
import type { SessionCookieValue } from "@/lib/session";
export function requireDispatcherSession(): SessionCookieValue;
// Accepts role === 'dispatcher' OR role === 'admin'. Anything else → redirect('/login').
```

### Server action form-state shape
Reuses `AdminFormState` + `INITIAL_ADMIN_FORM_STATE` from `lib/admin-form.ts` verbatim. Not renaming the file in this feature (see Open Questions).

### Routes
No new HTTP API routes. All dispatcher pages are App Router server components; mutations are server actions.

## Implementation steps

1. **Reconcile core types.** Edit `/Users/abraham/lab-dispatch/lib/types.ts`:
   - Narrow `RouteStatus` to `'pending' | 'active' | 'completed'`.
   - Rewrite `Route` to `{ id, driverId, routeDate, status, startedAt?, completedAt?, createdAt }` (drop `stops`).
   - Rewrite `Stop` to `{ id, routeId, pickupRequestId, position, etaAt?, arrivedAt?, pickedUpAt?, createdAt }` (rename `sequence` → `position`, drop `officeId`).
   - Add `DriverLocation` and `Message` types per schema.
   - Change `PickupRequest.officeId` to `string | undefined`.
   Run `npm run typecheck` — it WILL fail at callers of `PickupRequest.officeId`, `Route`, `Stop`, and the interface. That's expected; move on.

2. **Fix existing consumers of the changed types.** Grep for each renamed/narrowed symbol and update:
   - `grep -rn 'sequence' app lib mocks interfaces` — rename to `position` where it refers to Stop.
   - `grep -rn '"draft"\|"assigned".*RouteStatus\|\.status ===.*"draft"' app lib mocks interfaces` — drop/replace with valid values.
   - `grep -rn 'route\.stops\|\.stops\[\]\|Route.*stops' app lib mocks interfaces` — callers that expected embedded stops now fetch via `listStops`.
   - `grep -rn 'officeId' app lib mocks interfaces` — audit each for undefined-safety.
   Current realistic hit list: `mocks/storage.ts` (the `NewPickupRequest` destructuring uses `officeId` — update so it's allowed to be undefined), `app/admin/doctors/*` (doctors have their own `officeId` that is NOT nullable — leave alone), no other meaningful hits.

3. **Extend `interfaces/storage.ts`.** Add the new types (`ListRoutesFilter`, `ListDriverLocationsFilter`, `ListMessagesFilter`, `NewRoute`, `DispatcherDashboardCounts`), widen `updatePickupRequestStatus` to `(id, status, flaggedReason?)`, add the 12 new methods to `StorageService`, and add `notConfigured()` stubs for each to `createRealStorageService()`.

4. **Update `NewPickupRequest`.** Change to `Omit<PickupRequest, "id" | "status" | "createdAt" | "updatedAt">` combined with the now-optional `officeId` + optional `status`. Verify existing callers (at minimum `mocks/storage.ts`'s own `createPickupRequest`) still typecheck.

5. **Extend storage mock.** Edit `/Users/abraham/lab-dispatch/mocks/storage.ts`:
   - Add `routes: Map<string, Route>`, `stops: Map<string, Stop>`, `driverLocations: DriverLocation[]` (array, not map — iteration-order matters for "latest per driver"), `messages: Map<string, Message>` to `state`.
   - Extend `updatePickupRequestStatus(id, status, flaggedReason?)`: if `flaggedReason` is provided, set it; if `status !== "flagged"`, clear `flaggedReason` to `undefined`; bump `updatedAt`.
   - Implement `listRoutes(filter)` — iterate `state.routes.values()`, filter by `date === routeDate`, `driverId`, `status`; sort by `createdAt` ascending.
   - Implement `getRoute(id)` → `state.routes.get(id) ?? null`.
   - Implement `createRoute(input)` → new id, `status: "pending"`, `createdAt: nowIso()`.
   - Implement `updateRouteStatus(id, status)` — look up, throw if missing, set `startedAt` / `completedAt` per the state-machine note in the contract, return new object.
   - Implement `listStops(routeId)` — filter `state.stops.values()` by `routeId`, sort by `position` asc.
   - Implement `assignRequestToRoute(routeId, pickupRequestId, position?)`:
     - Throw if route missing, request missing.
     - Throw if any stop with this `pickupRequestId` already exists anywhere (across all routes).
     - Compute next position if omitted: `(max of existing positions on this route) + 1`, default 1.
     - Insert stop; patch pickup request status to `"assigned"` via the internal state (bypassing `updatePickupRequestStatus` to avoid circular typing — inline set + bump `updatedAt`).
     - Return the new Stop.
   - Implement `removeStopFromRoute(stopId)`:
     - Throw if stop missing.
     - Get stop's `routeId` and `pickupRequestId`.
     - Delete stop.
     - Re-number remaining stops on that route: fetch them sorted by `position`, assign new positions `1..N`.
     - Flip the pickup request back to `"pending"`, clear `flaggedReason`, bump `updatedAt`.
   - Implement `reorderStops(routeId, orderedStopIds)`:
     - Fetch all stops for the route.
     - Assert `orderedStopIds.length === stops.length`, every id in `orderedStopIds` is in the set, every id maps to this route. Throw on violation.
     - Rewrite `position` for each stop to its index + 1.
   - Implement `listDriverLocations({ sinceMinutes = 15 } = {})`:
     - Cutoff = `Date.now() - sinceMinutes * 60_000`.
     - Filter `driverLocations` to entries whose `recordedAt >= cutoff`.
     - Group by `driverId`; pick the max-`recordedAt` entry per driver.
     - Return as array sorted by `recordedAt` desc.
   - Implement `listMessages({ flagged } = {})`:
     - Iterate messages.
     - If `flagged === true`: include a message if `pickupRequestId` is undefined OR the referenced pickup request has `status === "flagged"`.
     - Else: include all.
     - Sort by `receivedAt` desc.
   - Implement `createRequestFromMessage(messageId)`:
     - Throw if message missing.
     - Throw if `message.pickupRequestId` already set.
     - Create pickup request with the documented defaults.
     - Set `message.pickupRequestId = newRequest.id`, overwrite the message map entry.
     - Return the new request.
   - Implement `countDispatcherDashboard(dateIso)`:
     - `pendingRequests` = count of pickup_requests with `status === "pending"`.
     - `todayStops` = count of stops whose `routeId` maps to a route with `routeDate === dateIso` (default `dateIso = todayIso()` when undefined).
     - `activeRoutes` = count of routes with `status === "active"`.
     - `flaggedMessages` = count of messages that would pass the `flagged === true` filter above.
   - Add test helpers: `seedRoute`, `seedStop`, `seedDriverLocation`, `seedMessage` — each takes a full record (no id generation) and inserts it. Export; NOT on the interface.
   - Update `resetStorageMock()` to clear the four new maps/arrays.

6. **Extend storage mock tests.** Edit `/Users/abraham/lab-dispatch/mocks/storage.test.ts` to add cases for every method. See Tests section for exhaustive list. Run `npm run test -- mocks/storage` — green.

7. **Date + time helpers.** Create `/Users/abraham/lab-dispatch/lib/dates.ts` and `/Users/abraham/lab-dispatch/lib/dates.test.ts` per the contract. Run `npm run test -- dates` — green.

8. **Dispatcher session helper.** Create `/Users/abraham/lab-dispatch/lib/require-dispatcher.ts` and `/Users/abraham/lab-dispatch/lib/require-dispatcher.test.ts`. Mirror `require-admin` structure; the mock pattern is identical.

9. **Dispatcher layout chrome.** Create `/Users/abraham/lab-dispatch/components/DispatcherNavLink.tsx` (copy `AdminNavLink.tsx` verbatim except for component name) and `/Users/abraham/lab-dispatch/components/DispatcherLayout.tsx` (copy `AdminLayout.tsx`, swap sub-label to "Dispatcher", swap nav links to Dashboard/Requests/Routes/Map/Messages + Log out).

10. **Dashboard.** Rewrite `/Users/abraham/lab-dispatch/app/dispatcher/page.tsx` — async server component, `requireDispatcherSession()`, `countDispatcherDashboard(todayIso())`, four cards in `<DispatcherLayout title="Dashboard">`.

11. **Requests queue + actions.** Create the files under `app/dispatcher/requests/` (page, `_components/`, `new/page.tsx`, `new/_components/NewManualRequestForm.tsx`, `actions.ts`). Implement the four server actions. Handle the "assign to route" tri-state (no routes today → disabled select with link to new-route).

12. **Requests actions tests.** Create `app/dispatcher/requests/actions.test.ts`. Mock `next/navigation`, `next/cache`, `@/lib/require-dispatcher`. Each action: happy path + one failure path + auth bail-out.

13. **Routes list + new.** Create `app/dispatcher/routes/page.tsx` + `app/dispatcher/routes/new/page.tsx` + `_components/NewRouteForm.tsx`. Implement `createRouteAction` in `app/dispatcher/routes/actions.ts`.

14. **Routes detail + its actions.** Create `app/dispatcher/routes/[id]/page.tsx` + the three `_components/` files. Implement the seven stop/route-status server actions in `actions.ts`.

15. **Routes actions tests.** Create `app/dispatcher/routes/actions.test.ts`. For each action: happy, domain-error, auth bail-out.

16. **Map page.** Create `app/dispatcher/map/page.tsx`. No actions needed (read-only).

17. **Messages page + actions + tests.** Create `app/dispatcher/messages/page.tsx`, `_components/ConvertToRequestButton.tsx`, `actions.ts`, `actions.test.ts`.

18. **BUILD_LOG + BLOCKERS.** Append the dated build-log entry and the `[mapbox]` blocker entry (or sub-bullet under `[supabase]` if `[mapbox]` already exists).

19. **Verification gate.** Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. All must pass. Manual smoke (documented, not gated):
    - Sign in as the seeded dispatcher account (e.g. `dispatcher@test` / `test1234` — check `mocks/auth.ts` for the exact seed).
    - Hit `/dispatcher` — dashboard renders four cards.
    - Seed some data via an ad-hoc dev route or test harness (or include a dev-only seed step in the BUILD_LOG — flagged but not required; manual smoke can skip if tests cover it).
    - Create a manual request → appears in `/dispatcher/requests` with status `pending`.
    - Create a route → appears in `/dispatcher/routes`.
    - Assign the request to the route → request disappears from "pending" tab, appears as stop 1 on the route detail page.
    - Reorder / remove / re-assign the stop → positions update.
    - Flag a request with a reason → appears under "flagged" tab.
    - Open `/dispatcher/map` — either shows drivers or shows the "no recent pings" fallback.
    - Open `/dispatcher/messages` — shows the seeded messages; "Convert to request" creates a pending request.
    Note results in BUILD_LOG.

## Tests to write

### `lib/dates.test.ts`
All cases from the "New: date + formatting helpers" section: `todayIso` across three timezones with fixed `now`; date rollover at UTC midnight; `formatShortDateTime` happy + empty + garbage input (returns `"—"`); `formatDateIsoToShort` happy + empty.

### `lib/require-dispatcher.test.ts`
Four cases: admin → returns session; dispatcher → returns session; driver → redirects to `/login`; null session → redirects to `/login`. Mocks `@/lib/session` and `next/navigation`.

### `mocks/storage.test.ts` (extended)
- **`updatePickupRequestStatus` with flaggedReason**: setting status `flagged` + reason stores the reason; transitioning to `completed` clears the reason.
- **Routes CRUD**: `createRoute` returns a new route with `status: "pending"`; `listRoutes({})` returns all; `listRoutes({ date })` filters; `listRoutes({ driverId })` filters; `listRoutes({ status })` filters; `getRoute(id)` returns null on missing; `updateRouteStatus` transitions set timestamps correctly (pending→active sets startedAt; active→completed sets completedAt; completed→pending clears both).
- **Stops**: `listStops` returns ordered by position; empty when route has no stops; `assignRequestToRoute` with no position appends (position N+1); with explicit position inserts at that number (v1: does NOT shift other stops — positions are allowed to be non-contiguous after an explicit-position insert — OR we do shift; pick one and test it).
  - **Decision**: `assignRequestToRoute` with explicit position does NOT shift. Explicit-position inserts are rare (v1 UI never uses them). `reorderStops` is how the UI ensures contiguity. Test: after an explicit-position insert that collides with an existing stop's position, the mock throws `"stop at position N already exists"`. (This is a schema-level invariant too: `unique (route_id, position)`.)
- **`assignRequestToRoute` side effect**: pickup request status flips to `"assigned"`.
- **`assignRequestToRoute` guards**: throws on missing route, missing request, already-assigned request.
- **`removeStopFromRoute`**: deletes stop; re-numbers survivors to be contiguous 1..N; flips pickup request back to `"pending"`; clears `flaggedReason`; throws on missing stop id.
- **`reorderStops`**: rewrites positions; throws on mismatched ids / cross-route id / length mismatch.
- **`listDriverLocations`**: returns latest per driver within window; filters out stale; empty when no locations seeded; respects `sinceMinutes`.
- **`listMessages`**: returns all when no filter; returns orphan + flagged-linked when `flagged: true`; ordered by received desc.
- **`createRequestFromMessage`**: creates a pending request with the message's channel / sourceIdentifier / rawMessage; sets message.pickupRequestId; throws on missing id / already-linked.
- **`countDispatcherDashboard`**: sums across a seeded mixed state correctly.

### `app/dispatcher/requests/actions.test.ts`
Exhaustive list in "Files to create or modify". Each test reads data via `storageMock.listPickupRequests()` / `listRoutes()` etc. directly to assert outcomes. Mock `next/cache.revalidatePath`, `next/navigation.redirect`, `@/lib/require-dispatcher.requireDispatcherSession`. Every action has an auth-fail bail-out test.

### `app/dispatcher/routes/actions.test.ts`
Exhaustive list in "Files to create or modify". Same mock scaffold.

### `app/dispatcher/messages/actions.test.ts`
Three cases: convert happy path; missing messageId errors; auth bail-out.

### Explicitly NOT written in this feature
- No component-rendering or page-integration tests for any `/dispatcher/*` page or any `_components/` client child. Same rationale as `admin-ui`: too much harness for too little load-bearing coverage at this stage. Manual smoke handles form glue.
- No `DispatcherLayout` / `DispatcherNavLink` tests (purely presentational, trivially lifted from admin).
- No tests for the map page (read-only render; nothing to mutate).

## External services touched
- **Storage** — wrapped by `interfaces/storage.ts`; this feature extends the interface + mock heavily. Real adapter (`createRealStorageService()`) gets `NotConfiguredError` stubs for every new method; no live Supabase calls.
- **Auth** — read-only: pages call `getSession()` via `requireDispatcherSession`. No new `auth.*` writes.
- **Mapbox** — NOT called. `/dispatcher/map` renders a table + callout. A future feature wires Mapbox GL JS.
- **SMS / Email / Anthropic** — NOT called. Inbound message ingestion and AI re-parsing are separate features. This feature only READS `messages` and can create a blank pickup request from one via `createRequestFromMessage`.

## Open questions

1. **`lib/admin-form.ts` naming.** This feature reuses `AdminFormState` + `INITIAL_ADMIN_FORM_STATE` for dispatcher forms. The name now misleads. Three options: (a) leave alone (cheapest; minor tech debt), (b) rename to `lib/form-state.ts` in this feature (adds a rename commit + touches every admin action + every admin form client), (c) alias-re-export from a new `lib/form-state.ts` that just re-exports the existing names. Recommendation: (a) for this feature; file a small follow-up `rename-admin-form` task. Flagged so the builder doesn't silently choose (b) and inflate the diff.

2. **Stop count on `listRoutes`.** The routes list page fetches stops per route in an N+1 loop. Should the storage method return stop count inline (e.g. `listRoutes(): Promise<Array<Route & { stopCount: number }>>`)? Recommendation: no for this feature — dozens-of-routes scale makes N+1 trivial and the real Supabase adapter will collapse it with a `select ... count(stops.*)` sub-select. Revisit if perf complaints arise.

3. **Who can unassign / reassign stops?** Spec is silent. This feature lets any dispatcher (or admin acting as one) do anything to any route on any day. No per-route ownership model. Open if product wants per-route locking.

4. **Explicit-position insert semantics.** `assignRequestToRoute(routeId, requestId, position)` with a collision throws. UI never calls with an explicit position. We could equivalently support insert-and-shift. Picked throw-on-collision for minimum surface area. Flagging so nobody accidentally wires an explicit-position UI without revisiting.

5. **Seeding messages for smoke testing.** There's no inbound-webhook feature yet, so `messages` is empty in fresh mock state. Manual smoke of `/dispatcher/messages` requires either a tests-only path that seeds, or a temporary dev route. This feature does not add a dev seed route; the tests cover the page's logic. Flagging because the user may want a small dev seed to eyeball the page.

6. **`DriverLocation.id` as `string` vs `number`.** The SQL `id` is `bigserial`. The mock stringifies. When the real adapter lands, either the type changes to `string | number` (ugly) or the real adapter stringifies too (cheap). Picking "stringify everywhere" keeps the type clean; the cost is a tiny wrapping in the real adapter. Flagging so the builder knows.

7. **Per-lab timezone.** `todayIso()` defaults to UTC. When per-lab TZ lands (post-v1 or deep-in-v1), this default changes. Every caller in this feature passes no TZ; changing the default is a one-line edit plus audit. Documented in `lib/dates.ts` file-top comment.

8. **`flagged` filter semantics on `listMessages`.** The contract says `flagged: true` includes orphan messages (no linked request) AND messages whose linked request is `status = 'flagged'`. The UI checkbox tab reads "Flagged only". This matches user intent: both orphan and explicitly-flagged need human triage. Flagging in case the product owner expected a narrower definition (e.g., orphans only).
