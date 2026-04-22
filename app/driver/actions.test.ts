import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
const requireDriverSessionMock = vi.fn(() => ({
  userId: "driver-test",
  role: "driver" as const,
}));
const getTodaysRouteForDriverMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

vi.mock("@/lib/require-driver", () => ({
  requireDriverSession: () => requireDriverSessionMock(),
  requireDriverOrAdminSession: () => requireDriverSessionMock(),
}));

vi.mock("@/lib/today-route", () => ({
  getTodaysRouteForDriver: (driverId: string) =>
    getTodaysRouteForDriverMock(driverId),
}));

import {
  completeRouteAction,
  recordLocationAction,
  startRouteAction,
} from "./actions";
import { resetStorageMock, storageMock } from "@/mocks/storage";

async function seedRouteForDriver(driverId: string, routeDate = "2026-04-22") {
  return storageMock.createRoute({ driverId, routeDate });
}

async function seedStopOnRoute(routeId: string) {
  const req = await storageMock.createPickupRequest({
    officeId: "o1",
    channel: "manual",
    urgency: "routine",
  });
  return storageMock.assignRequestToRoute(routeId, req.id);
}

describe("driver server actions — startRouteAction", () => {
  beforeEach(() => {
    resetStorageMock();
    revalidatePathMock.mockClear();
    redirectMock.mockClear();
    requireDriverSessionMock.mockReset();
    requireDriverSessionMock.mockReturnValue({
      userId: "driver-1",
      role: "driver",
    });
  });

  it("transitions a pending route owned by the driver to active and redirects", async () => {
    const route = await seedRouteForDriver("driver-1");
    await expect(startRouteAction(route.id)).rejects.toThrow(
      /REDIRECT:\/driver\/route/,
    );
    const after = await storageMock.getRoute(route.id);
    expect(after?.status).toBe("active");
  });

  it("rejects when the route belongs to a different driver", async () => {
    const route = await seedRouteForDriver("driver-other");
    const spy = vi.spyOn(storageMock, "updateRouteStatus");
    await expect(startRouteAction(route.id)).rejects.toThrow(/not your route/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects when the route is not pending", async () => {
    const route = await seedRouteForDriver("driver-1");
    await storageMock.updateRouteStatus(route.id, "active");
    await expect(startRouteAction(route.id)).rejects.toThrow(/not pending/);
  });

  it("bails out on auth failure before calling storage", async () => {
    requireDriverSessionMock.mockImplementationOnce(() => {
      throw new Error("REDIRECT:/login");
    });
    const spy = vi.spyOn(storageMock, "updateRouteStatus");
    await expect(startRouteAction("anything")).rejects.toThrow(
      /REDIRECT:\/login/,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("driver server actions — completeRouteAction", () => {
  beforeEach(() => {
    resetStorageMock();
    revalidatePathMock.mockClear();
    redirectMock.mockClear();
    requireDriverSessionMock.mockReset();
    requireDriverSessionMock.mockReturnValue({
      userId: "driver-1",
      role: "driver",
    });
  });

  it("completes an active route when every stop is picked up", async () => {
    const route = await seedRouteForDriver("driver-1");
    const s1 = await seedStopOnRoute(route.id);
    await storageMock.updateRouteStatus(route.id, "active");
    await storageMock.markStopArrived(s1.id);
    await storageMock.markStopPickedUp(s1.id);

    await expect(completeRouteAction(route.id)).rejects.toThrow(
      /REDIRECT:\/driver/,
    );
    const after = await storageMock.getRoute(route.id);
    expect(after?.status).toBe("completed");
  });

  it("rejects when any stop is not picked up", async () => {
    const route = await seedRouteForDriver("driver-1");
    await seedStopOnRoute(route.id);
    await storageMock.updateRouteStatus(route.id, "active");
    await expect(completeRouteAction(route.id)).rejects.toThrow(
      /pending stops/,
    );
  });

  it("rejects wrong-driver", async () => {
    const route = await seedRouteForDriver("driver-other");
    await storageMock.updateRouteStatus(route.id, "active");
    await expect(completeRouteAction(route.id)).rejects.toThrow(
      /not your route/,
    );
  });

  it("bails out on auth failure", async () => {
    requireDriverSessionMock.mockImplementationOnce(() => {
      throw new Error("REDIRECT:/login");
    });
    const spy = vi.spyOn(storageMock, "updateRouteStatus");
    await expect(completeRouteAction("r")).rejects.toThrow(/REDIRECT:\/login/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("driver server actions — recordLocationAction", () => {
  beforeEach(() => {
    resetStorageMock();
    revalidatePathMock.mockClear();
    redirectMock.mockClear();
    requireDriverSessionMock.mockReset();
    requireDriverSessionMock.mockReturnValue({
      userId: "driver-1",
      role: "driver",
    });
    getTodaysRouteForDriverMock.mockReset();
  });

  it("records a location when the driver has an active route", async () => {
    const route = await seedRouteForDriver("driver-1");
    await storageMock.updateRouteStatus(route.id, "active");
    getTodaysRouteForDriverMock.mockResolvedValue({ ...route, status: "active" });

    const spy = vi.spyOn(storageMock, "recordDriverLocation");
    await recordLocationAction({ lat: 40.7, lng: -74.0 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toEqual({
      driverId: "driver-1",
      routeId: route.id,
      lat: 40.7,
      lng: -74.0,
    });
    spy.mockRestore();
  });

  it("is a silent no-op when the driver has no route today", async () => {
    getTodaysRouteForDriverMock.mockResolvedValue(null);
    const spy = vi.spyOn(storageMock, "recordDriverLocation");
    await recordLocationAction({ lat: 1, lng: 1 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("is a silent no-op when the route is pending / completed", async () => {
    getTodaysRouteForDriverMock.mockResolvedValue({
      id: "r",
      driverId: "driver-1",
      routeDate: "2026-04-22",
      status: "pending",
      createdAt: "2026-04-22T00:00:00Z",
    });
    const spy = vi.spyOn(storageMock, "recordDriverLocation");
    await recordLocationAction({ lat: 1, lng: 1 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects invalid coordinates (NaN, Infinity, out-of-range)", async () => {
    getTodaysRouteForDriverMock.mockResolvedValue(null);
    const spy = vi.spyOn(storageMock, "recordDriverLocation");
    await expect(
      recordLocationAction({ lat: Number.NaN, lng: 0 }),
    ).rejects.toThrow(/invalid lat/);
    await expect(
      recordLocationAction({ lat: 0, lng: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow(/invalid lng/);
    await expect(
      recordLocationAction({ lat: 95, lng: 0 }),
    ).rejects.toThrow(/invalid lat/);
    await expect(
      recordLocationAction({ lat: 0, lng: 181 }),
    ).rejects.toThrow(/invalid lng/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("bails out on auth failure before calling anything", async () => {
    requireDriverSessionMock.mockImplementationOnce(() => {
      throw new Error("REDIRECT:/login");
    });
    const spy = vi.spyOn(storageMock, "recordDriverLocation");
    await expect(
      recordLocationAction({ lat: 1, lng: 1 }),
    ).rejects.toThrow(/REDIRECT:\/login/);
    expect(spy).not.toHaveBeenCalled();
    expect(getTodaysRouteForDriverMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
