import type { Driver, Route, Stop } from "@/lib/types";

export type PayrollPreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "custom";

export interface PayrollDateRange {
  /** "YYYY-MM-DD" inclusive. */
  startDate: string;
  /** "YYYY-MM-DD" inclusive. */
  endDate: string;
}

export interface PayrollRow {
  driverId: string;
  driverName: string;
  /** ISO timestamp string. Empty when no route started in range. */
  startIso: string;
  /** ISO timestamp string. Empty when no stop picked up in range. */
  endIso: string;
  /** Total minutes between Start and End. 0 when either is empty. */
  workedMinutes: number;
  stopsDone: number;
}

export interface PayrollSummary {
  rows: PayrollRow[];
  /** Sum of all workedMinutes across drivers. */
  totalMinutes: number;
  /** Sum of all stopsDone across drivers. */
  totalStops: number;
}

const ALL_PRESETS: readonly PayrollPreset[] = [
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "custom",
] as const;

export const PRESET_LABEL: Record<PayrollPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week (Mon–Sun)",
  this_month: "This month",
  custom: "Custom",
};

export function isPayrollPreset(value: unknown): value is PayrollPreset {
  return typeof value === "string" && (ALL_PRESETS as readonly string[]).includes(value);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Resolve a preset (or custom range) to a concrete `[startDate, endDate]`
 * inclusive window. Custom requires `startDate` and `endDate` already in
 * "YYYY-MM-DD"; if either is malformed, falls back to today.
 *
 * "This week" is Mon–Sun for ergonomics: most lab pay periods anchor on
 * Monday, and the table reads cleaner that way than Sun–Sat.
 *
 * All math is in UTC. The date column on `routes` is naive — `2026-04-26`
 * means that calendar day in whatever timezone the dispatcher entered it
 * — so we don't try to localize. Driver UI continues to bucket by the
 * same naive day.
 */
export function resolveDateRange(
  preset: PayrollPreset,
  custom?: { startDate?: string; endDate?: string },
  now: Date = new Date(),
): PayrollDateRange {
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const today = toIsoDate(todayUtc);

  if (preset === "today") {
    return { startDate: today, endDate: today };
  }
  if (preset === "yesterday") {
    const y = new Date(todayUtc);
    y.setUTCDate(y.getUTCDate() - 1);
    const yIso = toIsoDate(y);
    return { startDate: yIso, endDate: yIso };
  }
  if (preset === "this_week") {
    // getUTCDay: Sun=0..Sat=6. Convert to Mon=0..Sun=6.
    const dow = (todayUtc.getUTCDay() + 6) % 7;
    const monday = new Date(todayUtc);
    monday.setUTCDate(monday.getUTCDate() - dow);
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    return { startDate: toIsoDate(monday), endDate: toIsoDate(sunday) };
  }
  if (preset === "this_month") {
    const first = new Date(
      Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 1),
    );
    const last = new Date(
      Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth() + 1, 0),
    );
    return { startDate: toIsoDate(first), endDate: toIsoDate(last) };
  }
  // custom
  const startOk = isIsoDate(custom?.startDate);
  const endOk = isIsoDate(custom?.endDate);
  if (startOk && endOk) {
    return {
      startDate: custom!.startDate as string,
      endDate: custom!.endDate as string,
    };
  }
  return { startDate: today, endDate: today };
}

function isoDateInRange(
  dateIso: string,
  startDate: string,
  endDate: string,
): boolean {
  return dateIso >= startDate && dateIso <= endDate;
}

/**
 * Builds payroll rows for every driver who has a route whose
 * `routeDate` is in `[startDate, endDate]`. Drivers with no qualifying
 * route are excluded — the table is "who worked?", not "every driver".
 *
 *   - Start = MIN(route.startedAt) for that driver's qualifying routes.
 *   - End   = MAX(stop.pickedUpAt) for stops on those routes.
 *   - Hours = End - Start (zero when either side is missing).
 *   - StopsDone = count of stops on those routes with pickedUpAt set.
 *
 * Routes still in `pending` status (no `startedAt`) and stops not yet
 * picked up are quietly skipped — they don't contribute to either bound.
 */
export function buildPayrollSummary(
  range: PayrollDateRange,
  data: { drivers: Driver[]; routes: Route[]; stopsByRoute: Map<string, Stop[]> },
): PayrollSummary {
  const driverById = new Map(data.drivers.map((d) => [d.profileId, d] as const));
  const inRangeRoutes = data.routes.filter((r) =>
    isoDateInRange(r.routeDate, range.startDate, range.endDate),
  );

  const perDriver = new Map<string, PayrollRow>();
  for (const route of inRangeRoutes) {
    const driver = driverById.get(route.driverId);
    if (!driver) continue;
    let row = perDriver.get(route.driverId);
    if (!row) {
      row = {
        driverId: route.driverId,
        driverName: driver.fullName,
        startIso: "",
        endIso: "",
        workedMinutes: 0,
        stopsDone: 0,
      };
      perDriver.set(route.driverId, row);
    }
    if (route.startedAt) {
      if (!row.startIso || route.startedAt < row.startIso) {
        row.startIso = route.startedAt;
      }
    }
    const stops = data.stopsByRoute.get(route.id) ?? [];
    for (const stop of stops) {
      if (stop.pickedUpAt) {
        row.stopsDone += 1;
        if (!row.endIso || stop.pickedUpAt > row.endIso) {
          row.endIso = stop.pickedUpAt;
        }
      }
    }
  }

  // Compute workedMinutes once we've folded all routes per driver.
  for (const row of perDriver.values()) {
    if (row.startIso && row.endIso) {
      const start = new Date(row.startIso).getTime();
      const end = new Date(row.endIso).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        row.workedMinutes = Math.round((end - start) / 60_000);
      }
    }
  }

  const rows = Array.from(perDriver.values()).sort((a, b) =>
    a.driverName.localeCompare(b.driverName),
  );
  const totalMinutes = rows.reduce((acc, r) => acc + r.workedMinutes, 0);
  const totalStops = rows.reduce((acc, r) => acc + r.stopsDone, 0);

  return { rows, totalMinutes, totalStops };
}

export function formatHoursMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0h 0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export function formatAvgPerStop(workedMinutes: number, stopsDone: number): string {
  if (stopsDone === 0 || workedMinutes <= 0) return "—";
  const avg = Math.round(workedMinutes / stopsDone);
  return formatHoursMinutes(avg);
}

const CSV_NEEDS_QUOTING = /[",\n\r]/;

function csvCell(value: string | number): string {
  const s = String(value);
  if (CSV_NEEDS_QUOTING.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Format an ISO timestamp as "YYYY-MM-DD HH:MM" (UTC) for the CSV. The
 * web table uses the standard `formatShortDateTime`; the CSV needs a
 * machine-friendly shape that Excel/Google Sheets can sort lexically.
 */
function formatIsoForCsv(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
    d.getUTCDate(),
  )} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function buildPayrollCsv(
  range: PayrollDateRange,
  summary: PayrollSummary,
): string {
  const lines: string[] = [];
  lines.push(
    [
      "Driver",
      "Start",
      "End",
      "Hours Worked",
      "Stops Done",
      "Avg per Stop",
    ]
      .map(csvCell)
      .join(","),
  );
  for (const row of summary.rows) {
    lines.push(
      [
        csvCell(row.driverName),
        csvCell(formatIsoForCsv(row.startIso)),
        csvCell(formatIsoForCsv(row.endIso)),
        csvCell(formatHoursMinutes(row.workedMinutes)),
        csvCell(row.stopsDone),
        csvCell(formatAvgPerStop(row.workedMinutes, row.stopsDone)),
      ].join(","),
    );
  }
  // Summary row at the bottom.
  lines.push(
    [
      csvCell("TOTAL"),
      "",
      "",
      csvCell(formatHoursMinutes(summary.totalMinutes)),
      csvCell(summary.totalStops),
      "",
    ].join(","),
  );
  // CSV files conventionally use CRLF but Excel handles either; LF keeps
  // diff-friendly with what tests check against.
  return lines.join("\n") + "\n";
}

export function payrollCsvFilename(range: PayrollDateRange): string {
  return `payroll-${range.startDate}-to-${range.endDate}.csv`;
}
