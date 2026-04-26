import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@/lib/types";

const revalidatePathMock = vi.fn();
const requireDriverSessionMock = vi.fn<
  [],
  { userId: string; role: UserRole }
>(() => ({
  userId: "driver-test",
  role: "driver",
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

vi.mock("@/lib/require-driver", () => ({
  requireDriverSession: () => requireDriverSessionMock(),
}));

import { arriveAtStopAction, pickupStopAction } from "./actions";
import { resetStorageMock, storageMock } from "@/mocks/storage";
import { getSent as getSentSms, resetSmsMock } from "@/mocks/sms";

async function seedActiveRouteWithStop(
  driverId = "driver-1",
  routeStatus: "active" | "pending" | "completed" = "active",
) {
  const route = await storageMock.createRoute({
    driverId,
    routeDate: "2026-04-22",
  });
  const request = await storageMock.createPickupRequest({
    officeId: "o1",
    channel: "manual",
    urgency: "routine",
  });
  const stop = await storageMock.assignRequestToRoute(route.id, request.id);
  if (routeStatus !== "pending") {
    await storageMock.updateRouteStatus(route.id, "active");
    if (routeStatus === "completed") {
      await storageMock.markStopArrived(stop.id);
      await storageMock.markStopPickedUp(stop.id);
      await storageMock.updateRouteStatus(route.id, "completed");
    }
  }
  return { route, stop };
}

describe("driver/route server actions — arriveAtStopAction", () => {
  beforeEach(() => {
    resetStorageMock();
    revalidatePathMock.mockClear();
    requireDriverSessionMock.mockReset();
    requireDriverSessionMock.mockReturnValue({
      userId: "driver-1",
      role: "driver",
    });
  });

  it("marks the stop arrived on the happy path", async () => {
    const { stop } = await seedActiveRouteWithStop("driver-1", "active");
    await arriveAtStopAction(stop.id);
    const after = await storageMock.getStop(stop.id);
    expect(after?.arrivedAt).toBeTruthy();
  });

  it("rejects when the stop belongs to another driver's route", async () => {
    const { stop } = await seedActiveRouteWithStop("driver-other", "active");
    const spy = vi.spyOn(storageMock, "markStopArrived");
    await expect(arriveAtStopAction(stop.id)).rejects.toThrow(/not your stop/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects when the route is not active", async () => {
    const { stop } = await seedActiveRouteWithStop("driver-1", "pending");
    await expect(arriveAtStopAction(stop.id)).rejects.toThrow(/not active/);
  });

  it("rejects unknown stop ids", async () => {
    await expect(arriveAtStopAction("missing")).rejects.toThrow(
      /stop missing not found/,
    );
  });

  it("surfaces storage already-arrived error", async () => {
    const { stop } = await seedActiveRouteWithStop("driver-1", "active");
    await storageMock.markStopArrived(stop.id);
    await expect(arriveAtStopAction(stop.id)).rejects.toThrow(/already arrived/);
  });

  it("bails out on auth failure", async () => {
    requireDriverSessionMock.mockImplementationOnce(() => {
      throw new Error("REDIRECT:/login");
    });
    const spy = vi.spyOn(storageMock, "markStopArrived");
    await expect(arriveAtStopAction("s")).rejects.toThrow(/REDIRECT:\/login/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("driver/route server actions — pickupStopAction", () => {
  beforeEach(() => {
    resetStorageMock();
    resetSmsMock();
    revalidatePathMock.mockClear();
    requireDriverSessionMock.mockReset();
    requireDriverSessionMock.mockReturnValue({
      userId: "driver-1",
      role: "driver",
    });
  });

  it("marks the stop picked up after arrival", async () => {
    const { stop } = await seedActiveRouteWithStop("driver-1", "active");
    await storageMock.markStopArrived(stop.id);
    await pickupStopAction(stop.id);
    const after = await storageMock.getStop(stop.id);
    expect(after?.pickedUpAt).toBeTruthy();
  });

  it("surfaces storage not-yet-arrived error", async () => {
    const { stop } = await seedActiveRouteWithStop("driver-1", "active");
    await expect(pickupStopAction(stop.id)).rejects.toThrow(/not yet arrived/);
  });

  it("rejects when the stop belongs to another driver", async () => {
    const { stop } = await seedActiveRouteWithStop("driver-other", "active");
    const spy = vi.spyOn(storageMock, "markStopPickedUp");
    await expect(pickupStopAction(stop.id)).rejects.toThrow(/not your stop/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects when the route is not active", async () => {
    const { stop } = await seedActiveRouteWithStop("driver-1", "pending");
    await expect(pickupStopAction(stop.id)).rejects.toThrow(/not active/);
  });

  it("bails out on auth failure", async () => {
    requireDriverSessionMock.mockImplementationOnce(() => {
      throw new Error("REDIRECT:/login");
    });
    const spy = vi.spyOn(storageMock, "markStopPickedUp");
    await expect(pickupStopAction("s")).rejects.toThrow(/REDIRECT:\/login/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("auto-completes the route when the last pending stop is picked up", async () => {
    const { route, stop } = await seedActiveRouteWithStop("driver-1", "active");
    await storageMock.markStopArrived(stop.id);

    await pickupStopAction(stop.id);

    const after = await storageMock.getRoute(route.id);
    expect(after?.status).toBe("completed");
    expect(after?.completedAt).toBeTruthy();
  });

  it("does not complete the route when other stops remain pending", async () => {
    const { route, stop } = await seedActiveRouteWithStop("driver-1", "active");
    // Add a second stop so the route is multi-stop.
    const req2 = await storageMock.createPickupRequest({
      officeId: "o1",
      channel: "manual",
      urgency: "routine",
    });
    await storageMock.assignRequestToRoute(route.id, req2.id);
    await storageMock.markStopArrived(stop.id);

    await pickupStopAction(stop.id);

    const after = await storageMock.getRoute(route.id);
    expect(after?.status).toBe("active");
    expect(after?.completedAt).toBeUndefined();
  });

  it("propagates markStopPickedUp errors and does not attempt completion", async () => {
    const { route, stop } = await seedActiveRouteWithStop("driver-1", "active");
    await storageMock.markStopArrived(stop.id);
    await storageMock.markStopPickedUp(stop.id);
    // Now the stop is already picked up — server action should surface
    // the error and NOT try to flip the route status again.
    const updateRouteStatusSpy = vi.spyOn(storageMock, "updateRouteStatus");
    await expect(pickupStopAction(stop.id)).rejects.toThrow(
      /already picked up/,
    );
    expect(updateRouteStatusSpy).not.toHaveBeenCalled();
    // Route should remain active; nothing flipped.
    const after = await storageMock.getRoute(route.id);
    expect(after?.status).toBe("active");
    updateRouteStatusSpy.mockRestore();
  });

  it("sends an SMS to the originating office when phone is on file", async () => {
    const office = await storageMock.createOffice({
      name: "Acme Clinic",
      slug: "acme",
      pickupUrlToken: "token12345678",
      address: { street: "1", city: "Princeton", state: "NJ", zip: "08540" },
      active: true,
      phone: "+15551234567",
    });
    const route = await storageMock.createRoute({
      driverId: "driver-1",
      routeDate: "2026-04-22",
    });
    const request = await storageMock.createPickupRequest({
      officeId: office.id,
      channel: "manual",
      urgency: "routine",
    });
    const stop = await storageMock.assignRequestToRoute(route.id, request.id);
    await storageMock.updateRouteStatus(route.id, "active");
    await storageMock.markStopArrived(stop.id);

    await pickupStopAction(stop.id);

    const sms = getSentSms();
    expect(sms).toHaveLength(1);
    expect(sms[0]?.to).toBe("+15551234567");
    expect(sms[0]?.body).toContain("Acme Clinic");
    expect(sms[0]?.body).toMatch(/picked up/i);
  });

  it("does not send SMS when the office has no phone", async () => {
    const office = await storageMock.createOffice({
      name: "No Phone Clinic",
      slug: "nophone",
      pickupUrlToken: "token87654321",
      address: { street: "1", city: "Princeton", state: "NJ", zip: "08540" },
      active: true,
    });
    const route = await storageMock.createRoute({
      driverId: "driver-1",
      routeDate: "2026-04-22",
    });
    const request = await storageMock.createPickupRequest({
      officeId: office.id,
      channel: "manual",
      urgency: "routine",
    });
    const stop = await storageMock.assignRequestToRoute(route.id, request.id);
    await storageMock.updateRouteStatus(route.id, "active");
    await storageMock.markStopArrived(stop.id);

    await pickupStopAction(stop.id);

    expect(getSentSms()).toHaveLength(0);
  });

  it("swallows SMS failures so the pickup still succeeds", async () => {
    const office = await storageMock.createOffice({
      name: "Acme",
      slug: "acme2",
      pickupUrlToken: "tokenabcd1234",
      address: { street: "1", city: "Princeton", state: "NJ", zip: "08540" },
      active: true,
      phone: "+15551234567",
    });
    const route = await storageMock.createRoute({
      driverId: "driver-1",
      routeDate: "2026-04-22",
    });
    const request = await storageMock.createPickupRequest({
      officeId: office.id,
      channel: "manual",
      urgency: "routine",
    });
    const stop = await storageMock.assignRequestToRoute(route.id, request.id);
    await storageMock.updateRouteStatus(route.id, "active");
    await storageMock.markStopArrived(stop.id);

    // Force an SMS failure by corrupting the office lookup transiently.
    const getOfficeSpy = vi
      .spyOn(storageMock, "getOffice")
      .mockRejectedValueOnce(new Error("transient failure"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await pickupStopAction(stop.id);

    const after = await storageMock.getStop(stop.id);
    expect(after?.pickedUpAt).toBeTruthy();
    expect(getSentSms()).toHaveLength(0);

    getOfficeSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("rejects an admin session attempting to pickup on behalf of a driver", async () => {
    const { stop } = await seedActiveRouteWithStop("driver-1", "active");
    await storageMock.markStopArrived(stop.id);
    requireDriverSessionMock.mockReturnValueOnce({
      userId: "admin-1",
      role: "admin",
    });
    const pickupSpy = vi.spyOn(storageMock, "markStopPickedUp");
    await expect(pickupStopAction(stop.id)).rejects.toThrow(/not your stop/);
    expect(pickupSpy).not.toHaveBeenCalled();
    pickupSpy.mockRestore();
  });
});
