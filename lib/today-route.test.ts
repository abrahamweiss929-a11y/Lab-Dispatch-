import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStorageMock, seedRoute, storageMock } from "@/mocks/storage";
import type { Route } from "@/lib/types";
import { getTodaysRouteForDriver } from "@/lib/today-route";

function makeRoute(partial: Partial<Route> & { id: string; driverId: string; routeDate: string; createdAt: string }): Route {
  return {
    id: partial.id,
    driverId: partial.driverId,
    routeDate: partial.routeDate,
    status: partial.status ?? "pending",
    startedAt: partial.startedAt,
    completedAt: partial.completedAt,
    createdAt: partial.createdAt,
  };
}

describe("getTodaysRouteForDriver", () => {
  beforeEach(() => {
    resetStorageMock();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the sole route for this driver on today's date (UTC)", async () => {
    seedRoute(
      makeRoute({
        id: "r1",
        driverId: "d1",
        routeDate: "2026-04-22",
        createdAt: "2026-04-22T08:00:00Z",
      }),
    );
    const route = await getTodaysRouteForDriver("d1");
    expect(route?.id).toBe("r1");
  });

  it("returns null when the driver has no routes", async () => {
    const route = await getTodaysRouteForDriver("nobody");
    expect(route).toBeNull();
  });

  it("returns null when the driver's routes are on other dates", async () => {
    seedRoute(
      makeRoute({
        id: "r-past",
        driverId: "d1",
        routeDate: "2026-04-21",
        createdAt: "2026-04-21T08:00:00Z",
      }),
    );
    seedRoute(
      makeRoute({
        id: "r-future",
        driverId: "d1",
        routeDate: "2026-04-23",
        createdAt: "2026-04-23T08:00:00Z",
      }),
    );
    const route = await getTodaysRouteForDriver("d1");
    expect(route).toBeNull();
  });

  it("returns the earliest-created when multiple exist (defensive)", async () => {
    seedRoute(
      makeRoute({
        id: "early",
        driverId: "d1",
        routeDate: "2026-04-22",
        createdAt: "2026-04-22T06:00:00Z",
      }),
    );
    seedRoute(
      makeRoute({
        id: "late",
        driverId: "d1",
        routeDate: "2026-04-22",
        createdAt: "2026-04-22T07:00:00Z",
      }),
    );
    const route = await getTodaysRouteForDriver("d1");
    expect(route?.id).toBe("early");
  });

  it("respects a non-UTC timeZone arg", async () => {
    // Local time = 2026-04-22T23:30Z; in Pacific/Auckland the calendar day
    // is already 2026-04-23.
    vi.setSystemTime(new Date("2026-04-22T23:30:00Z"));
    const tomorrowRoute = await storageMock.createRoute({
      driverId: "d1",
      routeDate: "2026-04-23",
    });
    expect(
      await getTodaysRouteForDriver("d1", "Pacific/Auckland"),
    ).toEqual(tomorrowRoute);
    expect(await getTodaysRouteForDriver("d1")).toBeNull();
  });
});
