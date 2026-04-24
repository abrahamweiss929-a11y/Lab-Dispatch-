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
import { getSent, resetSmsMock, smsMock } from "@/mocks/sms";
import { HEADS_UP_COPY } from "@/lib/heads-up";
import type { Office, OfficeAddress } from "@/lib/types";

const ADDRESS: OfficeAddress = {
  street: "100 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

async function seedOfficeWithCoords(
  name: string,
  opts: { lat?: number; lng?: number; phone?: string } = {},
): Promise<Office> {
  return storageMock.createOffice({
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    pickupUrlToken: `tok-${name.toLowerCase().replace(/\s+/g, "-")}`,
    address: ADDRESS,
    active: true,
    lat: opts.lat,
    lng: opts.lng,
    phone: opts.phone,
  });
}

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

  it("redirects home without error when the route is already completed", async () => {
    const route = await seedRouteForDriver("driver-1");
    const s1 = await seedStopOnRoute(route.id);
    await storageMock.updateRouteStatus(route.id, "active");
    await storageMock.markStopArrived(s1.id);
    await storageMock.markStopPickedUp(s1.id);
    await storageMock.updateRouteStatus(route.id, "completed");

    const spy = vi.spyOn(storageMock, "updateRouteStatus");
    await expect(completeRouteAction(route.id)).rejects.toThrow(
      /REDIRECT:\/driver/,
    );
    // No second transition — it was already completed.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("redirects home without error when the route is still pending, and logs a warning", async () => {
    const route = await seedRouteForDriver("driver-1");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const updateSpy = vi.spyOn(storageMock, "updateRouteStatus");

    await expect(completeRouteAction(route.id)).rejects.toThrow(
      /REDIRECT:\/driver/,
    );
    expect(updateSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unexpected status "pending"'),
    );

    warnSpy.mockRestore();
    updateSpy.mockRestore();
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

describe("driver server actions — recordLocationAction heads-up integration", () => {
  beforeEach(() => {
    resetStorageMock();
    resetSmsMock();
    revalidatePathMock.mockClear();
    redirectMock.mockClear();
    requireDriverSessionMock.mockReset();
    requireDriverSessionMock.mockReturnValue({
      userId: "driver-1",
      role: "driver",
    });
    getTodaysRouteForDriverMock.mockReset();
  });

  async function seedActiveRouteWithOfficeStop(office: Office) {
    const route = await storageMock.createRoute({
      driverId: "driver-1",
      routeDate: "2026-04-22",
    });
    const req = await storageMock.createPickupRequest({
      officeId: office.id,
      channel: "manual",
      urgency: "routine",
    });
    const stop = await storageMock.assignRequestToRoute(route.id, req.id);
    await storageMock.updateRouteStatus(route.id, "active");
    getTodaysRouteForDriverMock.mockResolvedValue({
      ...route,
      status: "active",
    });
    return { route, stop };
  }

  it("sends the heads-up SMS when the driver is near the next stop's office", async () => {
    const office = await seedOfficeWithCoords("Acme", {
      lat: 40.0,
      lng: -74.0,
      phone: "+15551234567",
    });
    const { stop } = await seedActiveRouteWithOfficeStop(office);

    await recordLocationAction({
      lat: office.lat as number,
      lng: office.lng as number,
    });

    const sent = getSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("+15551234567");
    expect(sent[0]?.body).toBe(HEADS_UP_COPY);
    const refreshed = await storageMock.getStop(stop.id);
    expect(refreshed?.notified10min).toBe(true);
  });

  it("does not send the SMS when the driver is far from the next stop", async () => {
    const office = await seedOfficeWithCoords("Far", {
      lat: 40.0,
      lng: -74.0,
      phone: "+15551234567",
    });
    const { stop } = await seedActiveRouteWithOfficeStop(office);

    await recordLocationAction({ lat: 35.0, lng: -80.0 });

    expect(getSent()).toHaveLength(0);
    const refreshed = await storageMock.getStop(stop.id);
    expect(refreshed?.notified10min).toBe(false);
  });

  it("does not re-send when notified10min is already true", async () => {
    const office = await seedOfficeWithCoords("Acme", {
      lat: 40.0,
      lng: -74.0,
      phone: "+15551234567",
    });
    const { stop } = await seedActiveRouteWithOfficeStop(office);
    await storageMock.markStopNotified10min(stop.id);

    await recordLocationAction({
      lat: office.lat as number,
      lng: office.lng as number,
    });

    expect(getSent()).toHaveLength(0);
  });

  it("does not send the SMS when the office has no phone (location still persisted)", async () => {
    const office = await seedOfficeWithCoords("NoPhone", {
      lat: 40.0,
      lng: -74.0,
    });
    await seedActiveRouteWithOfficeStop(office);

    await recordLocationAction({
      lat: office.lat as number,
      lng: office.lng as number,
    });

    expect(getSent()).toHaveLength(0);
    const locs = await storageMock.listDriverLocations({ sinceMinutes: 5 });
    expect(locs.map((l) => l.driverId)).toContain("driver-1");
  });

  it("still persists the location when sms.sendSms rejects", async () => {
    const office = await seedOfficeWithCoords("Acme", {
      lat: 40.0,
      lng: -74.0,
      phone: "+15551234567",
    });
    await seedActiveRouteWithOfficeStop(office);
    vi.spyOn(smsMock, "sendSms").mockRejectedValueOnce(new Error("twilio 500"));
    // Silence the expected console.error to keep test output clean; the
    // action explicitly console.errors when maybeNotifyOffice throws.
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      recordLocationAction({
        lat: office.lat as number,
        lng: office.lng as number,
      }),
    ).resolves.toBeUndefined();

    const locs = await storageMock.listDriverLocations({ sinceMinutes: 5 });
    expect(locs.map((l) => l.driverId)).toContain("driver-1");
    errSpy.mockRestore();
  });
});
