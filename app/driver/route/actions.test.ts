import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePathMock = vi.fn();
const requireDriverSessionMock = vi.fn(() => ({
  userId: "driver-test",
  role: "driver" as const,
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

vi.mock("@/lib/require-driver", () => ({
  requireDriverSession: () => requireDriverSessionMock(),
}));

import { arriveAtStopAction, pickupStopAction } from "./actions";
import { resetStorageMock, storageMock } from "@/mocks/storage";

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
});
