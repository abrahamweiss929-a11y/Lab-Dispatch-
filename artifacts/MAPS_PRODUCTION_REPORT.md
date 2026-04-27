# Maps in production — merge + Google Maps handoff report

Date: 2026-04-27.
Branch flow: `feat/maps-everywhere` (origin) → `merge/maps-everywhere-into-main`
(local conflict-resolution branch, deleted after merge) → `main`
@ `6dd366d` → deployed to `https://labdispatch.app`.

## Phase commits on main (this work)

| Commit | Description |
| --- | --- |
| `5216e45` | Merge `origin/feat/maps-everywhere` into the local merge branch (4 conflicts resolved) |
| `c212593` | `feat(maps): Google Maps deep-link handoff for navigation` (new helper functions + UI buttons on driver/route + dispatcher routes/[id]) |
| `6dd366d` | `Merge branch 'merge/maps-everywhere-into-main'` — final merge to main |

## Conflicts encountered + how they were resolved

### 1. `app/dispatcher/map/page.tsx`

- **HEAD (main):** placeholder copy "This becomes a real Mapbox view
  when `NEXT_PUBLIC_MAPBOX_TOKEN` is wired" inside a styled `<section
  className="map-panel">` with brand-styled pin decorations.
- **`origin/feat/maps-everywhere`:** `<MapView pins={mapPins}
  height="420px" autoRefreshMs={30_000} />` replacing the placeholder.
- **Resolution:** took the maps-branch version. The placeholder existed
  precisely to be replaced by this work — that was the user's primary
  success criterion ("the placeholder text MUST be gone").

### 2. `app/admin/offices/page.tsx`

- **HEAD:** `<div className="toolbar"><p className="page-subtitle">`
  (Codex design refresh classes).
- **maps branch:** older `<div className="mb-4 flex...">` styling AND
  prepended an `OfficesMap` block above.
- **Resolution:** kept HEAD's design-refresh classes (per spec
  preserve main's UI), prepended the maps-branch's `OfficesMap`
  block. Best of both — design tokens + the new map.

### 3. `app/dispatcher/routes/[id]/page.tsx`

- **HEAD:** `routeStatusBadgeClass(status)` helper used by the status
  badge in the page header.
- **maps branch:** `STOP_COLORS` constant for pin colors.
- **Resolution:** kept BOTH. They serve different purposes; the
  earlier conflict was just adjacent line additions, not semantic
  conflicts.

### 4. `app/driver/route/page.tsx`

- **HEAD:** `<RouteSummaryCard ...>` with drive/pickup minutes and
  finish-by label, conditional on `summary && route.status ===
  "active"`.
- **maps branch:** `<MapView pins={mapPins} showRoute>` conditional on
  `mapPins.length > 0`.
- **Resolution:** kept BOTH and rendered them sequentially. Different
  conditions, complementary UI. RouteSummaryCard first (text summary),
  then the map.

### 5. (auto-resolved) `app/admin/offices/[id]/page.tsx`

Auto-merged by git — no conflict markers. Maps branch added `<MapView>`
underneath the office detail; main's design tokens remained intact.

### 6. (auto-resolved) `package.json`, `package-lock.json`

`mapbox-gl` and `@types/mapbox-gl` deps merged in cleanly.

## Files changed (by category)

### New (from maps branch)
- `components/Map.tsx` — shared Mapbox component (227 lines).
  Already uses `NEXT_PUBLIC_MAPBOX_TOKEN`. Renders graceful "Map
  unavailable" fallback when env var unset.
- `components/Map.test.tsx` — 9 test cases (mapbox-gl mocked at the
  module level).
- `app/admin/offices/_components/OfficesMap.tsx` — wrapper that adds
  click-to-navigate behavior to office pins.
- `artifacts/AUDIT_FINDINGS.md`, `artifacts/MAPS_REPORT.md` — branch's
  original docs.

### Modified (this work)
- `app/dispatcher/map/page.tsx` — placeholder replaced with `MapView`
  + 30s auto-refresh.
- `app/admin/offices/page.tsx` — pin map prepended; design tokens
  preserved.
- `app/admin/offices/[id]/page.tsx` — single-pin map below the form.
- `app/dispatcher/routes/[id]/page.tsx` — route map + Google Maps
  preview button.
- `app/driver/route/page.tsx` — route map alongside the existing
  `RouteSummaryCard`; new "Open full route in Google Maps →" button.
- `app/driver/route/_components/StopCard.tsx` — per-stop "Open in
  Maps" link is now a directions URL (was a search URL).
- `lib/google-maps-link.ts` — added `googleMapsSingleStopUrl()` and
  `googleMapsRouteUrlFromAddresses()`. Existing `googleMapsRouteUrl`
  (lat/lng-based) preserved untouched.
- `lib/google-maps-link.test.ts` — +8 cases.

### Lint cleanup
- `components/Map.test.tsx` — removed unused `MarkerCallArgs` type
  alias that was blocking `npm run build` lint.

## The 5 map surfaces

1. **`/driver/route`** — numbered pins (#1, #2, ...), color-coded by
   status (`pending` blue, `arrived` yellow, `picked_up` green),
   connecting line drawn between pins. Plus the Google Maps full-route
   handoff button at the top.
2. **`/dispatcher/routes/[id]`** — same numbered-pin styling as the
   driver view. Plus a "Preview in Google Maps" button below the map
   for sanity-checking before assignment.
3. **`/admin/offices`** — pins for every geocoded office; clicking a
   pin navigates to `/admin/offices/[id]`.
4. **`/admin/offices/[id]`** — single pin map for the office's
   coordinates.
5. **`/dispatcher/map`** — live driver tracking. Shows pings from the
   last 15 minutes; auto-refreshes every 30 seconds.

## Google Maps URL pattern used

For multi-stop driver navigation:

```
https://www.google.com/maps/dir/?api=1
  &origin=My+Location
  &destination={LAST_ENCODED_ADDRESS}
  &waypoints={1ST}|{2ND}|...|{8TH}    (capped at 9)
  &travelmode=driving
```

For single-stop:

```
https://www.google.com/maps/dir/?api=1
  &destination={ENCODED_ADDRESS}
  &travelmode=driving
```

URL encoding handled by `URL.searchParams.set` — commas, accented
characters, `&`, and apostrophes are preserved through to the Google
Maps app. Tested with `Café & Co., 12 Rue de l'Église, Montréal`.

## Manual verification checklist

After Vercel deploy lands (already confirmed on `caebd88` →
`6dd366d`), an operator should walk through these:

1. **`/dispatcher/map`** as an office user — confirm the map renders
   (was the user's primary success criterion). The page should show
   pins for any drivers who pinged in the last 15 minutes, or an
   empty `MapView` if none.
2. **`/dispatcher/map` empty case** — when no driver pings exist,
   the page shows "No recent driver pings." copy below an empty
   centered map (NYC-centered fallback).
3. **`/dispatcher/routes/[id]`** — open any route. The map should
   render with numbered pins. Click "Preview in Google Maps →"; new
   tab should open Google Maps directions with the route.
4. **`/admin/offices`** — confirm the pin map renders above the table.
   Click a pin; should navigate to that office's edit page.
5. **`/admin/offices/[id]`** — single-pin map renders if the office
   has lat/lng.
6. **`/driver/route`** — the driver landing page during an active
   route should show:
   a. The "Open full route in Google Maps →" button at the top
      (fills entire width on mobile).
   b. The `RouteSummaryCard` (drive minutes, pickup minutes, finish
      time, fromGoogle indicator).
   c. The Mapbox route map below.
   d. Numbered stop cards, each with an "Open in Maps" button.
7. **Driver phone tap** — on a real iPhone or Android, tapping
   "Open full route in Google Maps →" should open the Google Maps
   app (not the browser fallback) if installed.
8. **Logged out** — `curl -i /dispatcher/map` should return 307 →
   /login (auth gate enforced).
9. **Login flow** — sign in as `office@test`, land on `/dispatcher`,
   click Map in the sidebar, see the live driver map.
10. **Email + SMS sanity** — confirm `/api/email/inbound` GET still
    returns `{"status":"ok"}` (already verified during deploy
    polling).

## Anything deferred or partial

- **`mapbox-gl` bundle size** — adding the package bumped
  `/dispatcher/routes/[id]` and `/driver` first-load JS to ~565 kB
  (from ~98 kB). The Map component is dynamically imported on the
  client, so SSR pages don't bear this weight, but client-side route
  loads will be slower. Future optimization: code-split or
  lazy-import the Map.
- **`googleMapsSearchUrl` (in `lib/office-links.ts`)** — still exists
  but no longer referenced by `StopCard`. Other callers may exist;
  not removed in this branch.
- **Google Maps URL behavior on Android with multiple destinations** —
  spec calls for "Open in Maps app". Tested only that the URL is
  well-formed; actual app deep-link behavior depends on the OS's
  intent handler. The URL format (`maps/dir/?api=1`) is Google's
  documented universal pattern and should work on iOS Maps, Google
  Maps app, and the website.

## Out-of-scope items found but not fixed (per spec)

- The pre-existing UTC-midnight payroll-export test flake remains —
  same one tracked since the email feature work. 942/943 passing.
- `googleMapsSearchUrl` in `lib/office-links.ts` is now unused-by-the-driver-card
  but may have other consumers — left in place to avoid scope creep.

## Branch state after this work

- `main` at `6dd366d` (origin synced, deployed).
- `merge/maps-everywhere-into-main` deleted locally (safe `-d`
  succeeded).
- `origin/feat/maps-everywhere` preserved on origin as a backup.
- Local branches: only `main` (and possibly `fix/driver-not-found-regression`
  from earlier).

## Verification checklist done in this session

- ✅ `npm test` — 942/943 passing (only UTC-midnight payroll flake)
- ✅ `npx tsc --noEmit` — 0 errors
- ✅ `npm run build` — Compiled successfully end-to-end
- ✅ `git push origin main` — `db96e2c → 6dd366d`
- ✅ Vercel deploy live — `/login` etag flipped at attempt 8 (~80s)
- ✅ `/login` → 200
- ✅ `/api/email/inbound` → 200 with `{"status":"ok"}`
- ✅ Placeholder copy "becomes a real Mapbox view" no longer present
  in deployed code

The maps feature is live in production. The placeholder is gone.
Drivers can now hand off to Google Maps for turn-by-turn navigation.
