import { describe, expect, it } from "vitest";
import type { Driver, Route, Stop } from "@/lib/types";
import {
  buildPayrollCsv,
  buildPayrollSummary,
  formatAvgPerStop,
  formatHoursMinutes,
  payrollCsvFilename,
  resolveDateRange,
} from "./payroll";

function driver(id: string, name: string): Driver {
  return {
    profileId: id,
    fullName: name,
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function route(input: Partial<Route> & Pick<Route, "id" | "driverId" | "routeDate">): Route {
  return {
    id: input.id,
    driverId: input.driverId,
    routeDate: input.routeDate,
    status: input.status ?? "completed",
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    createdAt: input.createdAt ?? "2026-01-01T00:00:00Z",
  };
}

function stop(input: Partial<Stop> & Pick<Stop, "id" | "routeId" | "pickupRequestId" | "position">): Stop {
  return {
    id: input.id,
    routeId: input.routeId,
    pickupRequestId: input.pickupRequestId,
    position: input.position,
    etaAt: input.etaAt,
    arrivedAt: input.arrivedAt,
    pickedUpAt: input.pickedUpAt,
    notified10min: input.notified10min ?? false,
    createdAt: input.createdAt ?? "2026-01-01T00:00:00Z",
  };
}

describe("resolveDateRange", () => {
  const NOW = new Date("2026-04-26T15:00:00Z"); // Sunday

  it("today: same start and end", () => {
    expect(resolveDateRange("today", undefined, NOW)).toEqual({
      startDate: "2026-04-26",
      endDate: "2026-04-26",
    });
  });

  it("yesterday: walks back one day", () => {
    expect(resolveDateRange("yesterday", undefined, NOW)).toEqual({
      startDate: "2026-04-25",
      endDate: "2026-04-25",
    });
  });

  it("this_week: Mon-Sun including today", () => {
    expect(resolveDateRange("this_week", undefined, NOW)).toEqual({
      startDate: "2026-04-20",
      endDate: "2026-04-26",
    });
  });

  it("this_week: Monday lands on itself", () => {
    const monday = new Date("2026-04-20T15:00:00Z");
    expect(resolveDateRange("this_week", undefined, monday)).toEqual({
      startDate: "2026-04-20",
      endDate: "2026-04-26",
    });
  });

  it("this_month: first day to last day", () => {
    expect(resolveDateRange("this_month", undefined, NOW)).toEqual({
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });
  });

  it("custom: well-formed inputs pass through", () => {
    expect(
      resolveDateRange(
        "custom",
        { startDate: "2026-03-01", endDate: "2026-03-31" },
        NOW,
      ),
    ).toEqual({ startDate: "2026-03-01", endDate: "2026-03-31" });
  });

  it("custom: malformed inputs fall back to today", () => {
    expect(
      resolveDateRange("custom", { startDate: "bogus", endDate: "" }, NOW),
    ).toEqual({ startDate: "2026-04-26", endDate: "2026-04-26" });
  });
});

describe("buildPayrollSummary", () => {
  const drivers = [driver("d1", "Alice"), driver("d2", "Bob"), driver("d3", "Carol")];

  it("returns empty rows when no routes in range", () => {
    const summary = buildPayrollSummary(
      { startDate: "2026-04-26", endDate: "2026-04-26" },
      { drivers, routes: [], stopsByRoute: new Map() },
    );
    expect(summary.rows).toEqual([]);
    expect(summary.totalMinutes).toBe(0);
    expect(summary.totalStops).toBe(0);
  });

  it("filters routes by routeDate inclusive", () => {
    const r1 = route({
      id: "r1",
      driverId: "d1",
      routeDate: "2026-04-25",
      startedAt: "2026-04-25T08:00:00Z",
    });
    const r2 = route({
      id: "r2",
      driverId: "d1",
      routeDate: "2026-04-26",
      startedAt: "2026-04-26T08:00:00Z",
    });
    const r3 = route({
      id: "r3",
      driverId: "d1",
      routeDate: "2026-04-27",
      startedAt: "2026-04-27T08:00:00Z",
    });
    const stops = new Map<string, Stop[]>();
    stops.set("r1", [
      stop({
        id: "s1",
        routeId: "r1",
        pickupRequestId: "p1",
        position: 1,
        pickedUpAt: "2026-04-25T09:00:00Z",
      }),
    ]);
    stops.set("r2", [
      stop({
        id: "s2",
        routeId: "r2",
        pickupRequestId: "p2",
        position: 1,
        pickedUpAt: "2026-04-26T09:00:00Z",
      }),
    ]);
    stops.set("r3", [
      stop({
        id: "s3",
        routeId: "r3",
        pickupRequestId: "p3",
        position: 1,
        pickedUpAt: "2026-04-27T09:00:00Z",
      }),
    ]);
    const summary = buildPayrollSummary(
      { startDate: "2026-04-25", endDate: "2026-04-26" },
      { drivers, routes: [r1, r2, r3], stopsByRoute: stops },
    );
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].stopsDone).toBe(2);
  });

  it("computes Start as MIN(startedAt) and End as MAX(pickedUpAt) per driver", () => {
    const r1 = route({
      id: "r1",
      driverId: "d1",
      routeDate: "2026-04-26",
      startedAt: "2026-04-26T07:30:00Z",
    });
    const r2 = route({
      id: "r2",
      driverId: "d1",
      routeDate: "2026-04-26",
      startedAt: "2026-04-26T08:00:00Z",
    });
    const stops = new Map<string, Stop[]>();
    stops.set("r1", [
      stop({
        id: "s1",
        routeId: "r1",
        pickupRequestId: "p1",
        position: 1,
        pickedUpAt: "2026-04-26T09:00:00Z",
      }),
      stop({
        id: "s2",
        routeId: "r1",
        pickupRequestId: "p2",
        position: 2,
        pickedUpAt: "2026-04-26T15:30:00Z",
      }),
    ]);
    stops.set("r2", [
      stop({
        id: "s3",
        routeId: "r2",
        pickupRequestId: "p3",
        position: 1,
        pickedUpAt: "2026-04-26T11:00:00Z",
      }),
    ]);
    const summary = buildPayrollSummary(
      { startDate: "2026-04-26", endDate: "2026-04-26" },
      { drivers, routes: [r1, r2], stopsByRoute: stops },
    );
    expect(summary.rows[0].startIso).toBe("2026-04-26T07:30:00Z");
    expect(summary.rows[0].endIso).toBe("2026-04-26T15:30:00Z");
    // 7:30 → 15:30 = 480 minutes = 8h
    expect(summary.rows[0].workedMinutes).toBe(480);
    expect(summary.rows[0].stopsDone).toBe(3);
  });

  it("does not count stops that are not picked up", () => {
    const r = route({
      id: "r1",
      driverId: "d1",
      routeDate: "2026-04-26",
      startedAt: "2026-04-26T08:00:00Z",
    });
    const stops = new Map<string, Stop[]>();
    stops.set("r1", [
      stop({
        id: "s1",
        routeId: "r1",
        pickupRequestId: "p1",
        position: 1,
        pickedUpAt: "2026-04-26T09:00:00Z",
      }),
      stop({
        id: "s2",
        routeId: "r1",
        pickupRequestId: "p2",
        position: 2,
      }),
    ]);
    const summary = buildPayrollSummary(
      { startDate: "2026-04-26", endDate: "2026-04-26" },
      { drivers, routes: [r], stopsByRoute: stops },
    );
    expect(summary.rows[0].stopsDone).toBe(1);
  });

  it("orders rows by driver name ascending", () => {
    const ra = route({
      id: "rA",
      driverId: "d1",
      routeDate: "2026-04-26",
      startedAt: "2026-04-26T08:00:00Z",
    });
    const rb = route({
      id: "rB",
      driverId: "d2",
      routeDate: "2026-04-26",
      startedAt: "2026-04-26T08:00:00Z",
    });
    const rc = route({
      id: "rC",
      driverId: "d3",
      routeDate: "2026-04-26",
      startedAt: "2026-04-26T08:00:00Z",
    });
    const stops = new Map<string, Stop[]>();
    const summary = buildPayrollSummary(
      { startDate: "2026-04-26", endDate: "2026-04-26" },
      { drivers, routes: [rc, rb, ra], stopsByRoute: stops },
    );
    expect(summary.rows.map((r) => r.driverName)).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
  });

  it("totals across drivers", () => {
    const r1 = route({
      id: "r1",
      driverId: "d1",
      routeDate: "2026-04-26",
      startedAt: "2026-04-26T08:00:00Z",
    });
    const r2 = route({
      id: "r2",
      driverId: "d2",
      routeDate: "2026-04-26",
      startedAt: "2026-04-26T08:00:00Z",
    });
    const stops = new Map<string, Stop[]>();
    stops.set("r1", [
      stop({
        id: "s1",
        routeId: "r1",
        pickupRequestId: "p1",
        position: 1,
        pickedUpAt: "2026-04-26T10:00:00Z",
      }),
    ]);
    stops.set("r2", [
      stop({
        id: "s2",
        routeId: "r2",
        pickupRequestId: "p2",
        position: 1,
        pickedUpAt: "2026-04-26T11:00:00Z",
      }),
    ]);
    const summary = buildPayrollSummary(
      { startDate: "2026-04-26", endDate: "2026-04-26" },
      { drivers, routes: [r1, r2], stopsByRoute: stops },
    );
    // Alice: 8:00 → 10:00 = 120; Bob: 8:00 → 11:00 = 180.
    expect(summary.totalMinutes).toBe(300);
    expect(summary.totalStops).toBe(2);
  });
});

describe("formatHoursMinutes", () => {
  it("renders as Xh Ym", () => {
    expect(formatHoursMinutes(0)).toBe("0h 0m");
    expect(formatHoursMinutes(59)).toBe("0h 59m");
    expect(formatHoursMinutes(60)).toBe("1h 0m");
    expect(formatHoursMinutes(125)).toBe("2h 5m");
  });
  it("treats negative or non-finite as zero", () => {
    expect(formatHoursMinutes(-5)).toBe("0h 0m");
    expect(formatHoursMinutes(NaN)).toBe("0h 0m");
  });
});

describe("formatAvgPerStop", () => {
  it("returns em-dash when no stops", () => {
    expect(formatAvgPerStop(120, 0)).toBe("—");
  });
  it("rounds to integer minutes", () => {
    expect(formatAvgPerStop(120, 4)).toBe("0h 30m");
    expect(formatAvgPerStop(125, 4)).toBe("0h 31m");
  });
});

describe("buildPayrollCsv", () => {
  it("escapes commas, quotes, and newlines in driver names", () => {
    const summary = {
      rows: [
        {
          driverId: "d1",
          driverName: 'O\'Hare, "Patrick"\nbig',
          startIso: "2026-04-26T08:00:00Z",
          endIso: "2026-04-26T16:00:00Z",
          workedMinutes: 480,
          stopsDone: 5,
        },
      ],
      totalMinutes: 480,
      totalStops: 5,
    };
    const csv = buildPayrollCsv(
      { startDate: "2026-04-26", endDate: "2026-04-26" },
      summary,
    );
    expect(csv).toContain('"O\'Hare, ""Patrick""\nbig"');
    expect(csv).toContain("2026-04-26 08:00");
    expect(csv).toContain("2026-04-26 16:00");
    expect(csv).toContain("8h 0m");
    expect(csv).toContain("TOTAL");
  });

  it("emits a header row, one per driver, then a TOTAL row", () => {
    const summary = {
      rows: [
        {
          driverId: "d1",
          driverName: "Alice",
          startIso: "2026-04-26T08:00:00Z",
          endIso: "2026-04-26T10:00:00Z",
          workedMinutes: 120,
          stopsDone: 2,
        },
        {
          driverId: "d2",
          driverName: "Bob",
          startIso: "2026-04-26T08:00:00Z",
          endIso: "2026-04-26T12:00:00Z",
          workedMinutes: 240,
          stopsDone: 3,
        },
      ],
      totalMinutes: 360,
      totalStops: 5,
    };
    const csv = buildPayrollCsv(
      { startDate: "2026-04-26", endDate: "2026-04-26" },
      summary,
    );
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("Driver,Start,End,Hours Worked,Stops Done,Avg per Stop");
    expect(lines[1].startsWith("Alice,")).toBe(true);
    expect(lines[2].startsWith("Bob,")).toBe(true);
    expect(lines[3].startsWith("TOTAL,,,")).toBe(true);
  });
});

describe("payrollCsvFilename", () => {
  it("encodes the range", () => {
    expect(
      payrollCsvFilename({ startDate: "2026-04-01", endDate: "2026-04-30" }),
    ).toBe("payroll-2026-04-01-to-2026-04-30.csv");
  });
});
