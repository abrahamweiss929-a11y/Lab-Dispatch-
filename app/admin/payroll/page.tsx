import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import { LocalDateTime } from "@/components/LocalDateTime";
import { getServices } from "@/interfaces";
import {
  buildPayrollSummary,
  formatAvgPerStop,
  formatHoursMinutes,
  isPayrollPreset,
  resolveDateRange,
  type PayrollPreset,
} from "@/lib/payroll";
import { requireAdminSession } from "@/lib/require-admin";
import type { Stop } from "@/lib/types";
import { DateRangePicker } from "./_components/DateRangePicker";

interface PayrollPageProps {
  searchParams?: {
    preset?: string;
    start?: string;
    end?: string;
  };
}

export default async function PayrollPage({ searchParams }: PayrollPageProps) {
  await requireAdminSession();

  const preset: PayrollPreset = isPayrollPreset(searchParams?.preset)
    ? searchParams!.preset
    : "today";
  const range = resolveDateRange(preset, {
    startDate: searchParams?.start,
    endDate: searchParams?.end,
  });

  const storage = getServices().storage;
  const [drivers, routes] = await Promise.all([
    storage.listDrivers(),
    storage.listRoutes(),
  ]);
  // Only fetch stops for routes whose date is within range — avoids a
  // listStops-per-route fanout on the entire history.
  const inRangeRoutes = routes.filter(
    (r) => r.routeDate >= range.startDate && r.routeDate <= range.endDate,
  );
  const stopsByRoute = new Map<string, Stop[]>();
  await Promise.all(
    inRangeRoutes.map(async (route) => {
      stopsByRoute.set(route.id, await storage.listStops(route.id));
    }),
  );

  const summary = buildPayrollSummary(range, {
    drivers,
    routes: inRangeRoutes,
    stopsByRoute,
  });

  const csvHref = `/admin/payroll/export?preset=${preset}&start=${encodeURIComponent(range.startDate)}&end=${encodeURIComponent(range.endDate)}`;

  return (
    <AdminLayout title="Payroll">
      <DateRangePicker
        initialPreset={preset}
        initialStartDate={range.startDate}
        initialEndDate={range.endDate}
      />

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {range.startDate === range.endDate
            ? `For ${range.startDate}`
            : `From ${range.startDate} to ${range.endDate}`}
        </p>
        <Link href={csvHref} className="btn btn-secondary">
          Export CSV
        </Link>
      </div>

      {summary.rows.length === 0 ? (
        <p className="empty-state">
          No driver activity in this range. Pick a different preset or date.
        </p>
      ) : (
        <div className="data-table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left">Driver</th>
                <th className="px-4 py-2 text-left">Start</th>
                <th className="px-4 py-2 text-left">End</th>
                <th className="px-4 py-2 text-left">Hours Worked</th>
                <th className="px-4 py-2 text-left">Stops Done</th>
                <th className="px-4 py-2 text-left">Avg per Stop</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {summary.rows.map((row) => (
                <tr key={row.driverId}>
                  <td className="px-4 py-2 font-medium">{row.driverName}</td>
                  <td className="px-4 py-2">
                    {row.startIso ? <LocalDateTime iso={row.startIso} /> : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {row.endIso ? <LocalDateTime iso={row.endIso} /> : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {formatHoursMinutes(row.workedMinutes)}
                  </td>
                  <td className="px-4 py-2">{row.stopsDone}</td>
                  <td className="px-4 py-2">
                    {formatAvgPerStop(row.workedMinutes, row.stopsDone)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2" />
                <td className="px-4 py-2" />
                <td className="px-4 py-2">
                  {formatHoursMinutes(summary.totalMinutes)}
                </td>
                <td className="px-4 py-2">{summary.totalStops}</td>
                <td className="px-4 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
