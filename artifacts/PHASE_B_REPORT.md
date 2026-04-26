# Phase B — Payroll page

Branch: `feat/payroll-view` (off `main` @ `df4784a`)
Tests: **724 passing** (was 700; +24 new). `npx tsc --noEmit` clean.

## What shipped

### `lib/payroll.ts` — pure helpers

- `resolveDateRange(preset, custom?, now?)` collapses presets (`today`, `yesterday`, `this_week` Mon–Sun, `this_month`, `custom`) to a `{startDate, endDate}` window in ISO date strings. Custom requires both inputs to be `YYYY-MM-DD`; otherwise falls back to today.
- `buildPayrollSummary(range, {drivers, routes, stopsByRoute})` returns one `PayrollRow` per driver who has at least one route whose `routeDate` lies in `[startDate, endDate]`. Calculations:
  - `Start = MIN(route.startedAt)` across that driver's qualifying routes.
  - `End = MAX(stop.pickedUpAt)` across stops on those routes.
  - `workedMinutes = (End - Start)` rounded; zero when either bound missing.
  - `stopsDone = COUNT(pickedUpAt != null)`.
  - Rows sorted by driver name; totals computed across rows.
- `formatHoursMinutes(min)` → `"Xh Ym"`. `formatAvgPerStop(workedMin, stops)` → `"Xh Ym"` or `"—"` when no stops.
- `buildPayrollCsv(range, summary)` emits header + one row per driver + bottom `TOTAL` row. Cells with `,`, `"`, or newlines are quoted with embedded `"` doubled. ISO timestamps are flattened to `"YYYY-MM-DD HH:MM"` (UTC) for sheet-friendly sorting.
- `payrollCsvFilename(range)` → `"payroll-{startDate}-to-{endDate}.csv"`.

### `/admin/payroll` page

- Server component, `requireAdminSession` belt-and-suspenders.
- Reads `?preset=`, `?start=`, `?end=` from `searchParams`.
- Fetches `listDrivers()` and `listRoutes()` once, then `listStops(routeId)` only for routes whose date is in range — avoids fanning out across the entire history.
- Renders `DateRangePicker` + table + footer total. Empty state when no rows.
- Web table cells use `formatShortDateTime` (existing helper) for Start/End — no raw ISO strings on screen.
- "Export CSV" link is a regular `<a>` to `/admin/payroll/export?preset=…` so the browser downloads with the proper filename.

### `/admin/payroll/_components/DateRangePicker.tsx`

- Client component, controlled `<select>` with the five presets.
- Switching to `today` / `yesterday` / `this_week` / `this_month` immediately navigates with the new query string (via `useTransition`).
- Selecting `custom` reveals two `<input type="date">` controls and an Apply button. Apply pushes `?preset=custom&start=...&end=...`.
- `noValidate` + no `required` attrs — matches the F-05 form-validation policy already enforced repo-wide.

### `/admin/payroll/export` route handler

- Same `requireAdminSession` gate (also enforced by middleware, but kept inline so a misconfigured matcher can't leak the CSV).
- Reads the same query params, resolves the same range, runs the same summary builder, and returns `text/csv` with `Content-Disposition: attachment; filename="…"`.

### Sidebar

- Added a "Payroll" entry in `components/AdminLayout.tsx` between Offices and the active-link logout. `AdminNavLink` already handles the active-route highlight.

## Tests added (24)

| File | Count | Coverage |
|---|---|---|
| `lib/payroll.test.ts` | 20 | `resolveDateRange` × 7 (today, yesterday, this-week including Mon edge case, this-month, custom valid, custom malformed → fallback); `buildPayrollSummary` × 6 (empty, in/out-of-range filtering, MIN/MAX per driver, ignore non-picked-up stops, sorted by name, totals); `formatHoursMinutes` × 2; `formatAvgPerStop` × 2; `buildPayrollCsv` × 2 (escaping, structure); filename × 1 |
| `app/admin/payroll/export/route.test.ts` | 4 | non-admin redirect; headers + filename; empty CSV body shape; populated row body |

## Notes / tradeoffs

- "This week" is Mon–Sun, not Sun–Sat. Most lab pay periods anchor on Monday, and the table reads cleaner that way.
- Range filtering uses `routes.routeDate` (the calendar bucket), not `routes.startedAt`. A route dated 2026-04-26 but started at 2026-04-27 03:00 UTC still counts toward 2026-04-26 — matches how the dispatcher schedules the day.
- All date math is UTC. `routes.routeDate` is naive. Per-lab timezone is still SPEC future work.
- Drivers with no qualifying route in range are excluded from the table — it's "who worked?", not "every driver".
- Stops still in flight (no `pickedUpAt`) don't contribute to `End` or `stopsDone`, but their parent route still contributes its `startedAt` to `Start`.
- CSV uses `\n` line endings. Excel handles `\n` fine; tests are diff-friendly.

## Out of scope (for Phase D and beyond)

- Currently admin-only. Phase D will widen to the merged office role — the only required change is swapping `requireAdminSession` for whatever role-gate Phase D introduces.
- No "this pay period" preset that rolls automatically each fortnight — would need a configured pay-period anchor.
- No per-driver detail drilldown (linking the row to that driver's individual route history).

## Manual setup needed

None. Page is reachable at `/admin/payroll` once the branch is merged.
