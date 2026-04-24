# Maps everywhere — delivery report

Branch: `feat/maps-everywhere` (off `main`)

## Pages that got full maps

| Page | Status | Notes |
|---|---|---|
| `/driver/route` | ✅ Done | Numbered pins per stop, status colors (green=picked_up, yellow=arrived, blue=pending), polyline, popup shows `office name + address`. Wired in `app/driver/route/page.tsx`, not `/driver` itself — that's the today/home summary page with no stops to plot. |
| `/dispatcher/routes/[id]` | ✅ Done | Same visual style as /driver. |
| `/admin/offices` | ✅ Done | One pin per geocoded office. Click → edit page (via `OfficesMap` client wrapper that injects `useRouter().push`). Inactive offices shown in gray. |
| `/admin/offices/[id]` | ✅ Done | Single pin for the office above the edit form. |
| `/dispatcher/map` | ✅ Done | Replaces the "MAPBOX_TOKEN is wired" placeholder with live ping map + 30 s auto-refresh (`router.refresh()`). Tabular ping list kept below for drill-down. Empty state centers on NYC. |

All 5 target pages delivered — no features skipped, no priority fallback triggered.

## Commits

| Hash | Summary |
|---|---|
| `6418e91` | feat(map): shared Mapbox component with fallback + auto-refresh |
| `d213c89` | feat(driver): numbered-pin route map on driver route view |
| `f2b8b27` | feat(maps): wire map into dispatcher + admin office views |

## Design choices + tradeoffs

- **Component name is `MapView`, not `Map`.** `Map` shadowed the JS built-in used elsewhere (e.g. `new Map(...)` in the very same pages we were editing), which broke TypeScript inference. Renamed before wiring anything.
- **Single shared client component.** All five surfaces go through `components/Map.tsx`. Server pages build a `MapPin[]` and hand it off. Where a page needs behavior on pin-click (admin office list → navigate), a 10-line client wrapper (`app/admin/offices/_components/OfficesMap.tsx`) injects `useRouter().push` into `onPinClick`.
- **Auto-refresh lives inside `MapView`.** The dispatcher live page just passes `autoRefreshMs={30_000}`; `MapView` owns the `setInterval` + `router.refresh()`. Keeps polling logic out of the server page.
- **Graceful fallback paths.**
  - No `NEXT_PUBLIC_MAPBOX_TOKEN` → `"Map unavailable — NEXT_PUBLIC_MAPBOX_TOKEN not configured"` note (see test `renders the fallback when NEXT_PUBLIC_MAPBOX_TOKEN is unset`).
  - Zero pins → empty map centered on NYC (`[-74.006, 40.7128]`).
  - Pins with non-finite lat/lng (NaN, Infinity, out-of-range) → silently filtered (see test `filters out pins with non-finite coordinates`).
- **Polyline gated at ≥2 pins.** `showRoute` with a single pin is a no-op rather than an error.
- **Viewport heuristic:** 0 pins → NYC default zoom; 1 pin → recenter with zoom 13; ≥2 pins → `fitBounds` with 50 px padding and max-zoom 14 so single-block routes don't zoom to rooftops.
- **Pin filtering at the page level.** Each page skips stops/offices without `lat`/`lng` rather than passing them through and relying on the component's sanitizer. Avoids emitting a pin at `(0, 0)` from a half-seeded row.
- **Env var confirmed.** `NEXT_PUBLIC_MAPBOX_TOKEN` is already present in `.env.local:10`; no `.env.local` change needed.

## Testing

- `components/Map.test.tsx` — 9 regression tests covering empty-pins, single-pin center, 4-pin fitBounds, polyline wired when `showRoute && pins.length ≥ 2`, polyline skipped with 1 pin, bad-coord filtering, `onPinClick` firing on a marker click, missing-token fallback, and 30 s interval setup + teardown.
- `mapbox-gl` is module-mocked in Vitest because jsdom lacks WebGL — the real library throws at `new Map(...)` without a GL context. The mock records every call so the contract is asserted without GL.
- Full suite: **707 tests passing** (was 698 before; +9 from the Map component).
- Typecheck clean.

## Deferred / non-goals

- No component-level test for the popup text rendering (it's set via `setPopup(new Popup().setText(...))` — we assert the call, not the DOM that Mapbox renders).
- No visual regression / screenshot tests.
- Mapbox style is hardcoded to `streets-v12`. No dark-mode toggle.
- `autoRefreshMs` uses `router.refresh()` which refetches server data but doesn't stream — if the dispatcher page has 1000 pings, each refresh re-fetches the lot. Fine at v1 scale; revisit if it gets chatty.
- The `/driver` summary page (`app/driver/page.tsx`, not `/driver/route`) wasn't touched — it's a one-card status page with no stops to plot. If you want a mini-overview map there, that's a separate ask.

## Env + ops

- No dev-server restart needed for a code-only change. If `.env.local` were edited (it wasn't), a restart would be required because Next.js only loads env files at boot.
- Visit any wired page after `npm run dev` — the map renders immediately when the token is set, and shows the "Map unavailable" note if someone later removes `NEXT_PUBLIC_MAPBOX_TOKEN` from `.env.local`.

## Budget

Well under the $15 / 3 h cap. All five priority items landed.
