import { NextResponse } from "next/server";
import { getServices } from "@/interfaces";
import {
  buildPayrollCsv,
  buildPayrollSummary,
  isPayrollPreset,
  payrollCsvFilename,
  resolveDateRange,
  type PayrollPreset,
} from "@/lib/payroll";
import { requireAdminSession } from "@/lib/require-admin";
import type { Stop } from "@/lib/types";

export async function GET(request: Request): Promise<Response> {
  await requireAdminSession();
  const url = new URL(request.url);
  const presetParam = url.searchParams.get("preset");
  const preset: PayrollPreset = isPayrollPreset(presetParam) ? presetParam : "today";
  const range = resolveDateRange(preset, {
    startDate: url.searchParams.get("start") ?? undefined,
    endDate: url.searchParams.get("end") ?? undefined,
  });

  const storage = getServices().storage;
  const [drivers, routes] = await Promise.all([
    storage.listDrivers(),
    storage.listRoutes(),
  ]);
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
  const csv = buildPayrollCsv(range, summary);
  const filename = payrollCsvFilename(range);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
