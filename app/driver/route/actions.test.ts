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
import { getSentEmails, resetEmailMock } from "@/mocks/email";

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
    resetEmailMock();
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

  it("sends a 'driver arrived' email to the office when email is on file", async () => {
    const office = await storageMock.createOffice({
      name: "Acme Clinic",
      slug: "acme-arr",
      pickupUrlToken: "tokenarrived001",
      address: { street: "1", city: "Princeton", state: "NJ", zip: "08540" },
      active: true,
      email: "front@acme.test",
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

    await arriveAtStopAction(stop.id);

    const emails = getSentEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toBe("front@acme.test");
    expect(emails[0]?.subject).toBe("Driver has arrived at Acme Clinic");
    expect(emails[0]?.htmlBody).toContain("Acme Clinic");
  });

  it("does not send arrival email when office has no email", async () => {
    const office = await storageMock.createOffice({
      name: "No Email",
      slug: "noemail-arr",
      pickupUrlToken: "tokenarrived002",
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
    await arriveAtStopAction(stop.id);
    expect(getSentEmails()).toHaveLength(0);
  });

  it("swallows email failures so the arrival still succeeds", async () => {
    const office = await storageMock.createOffice({
      name: "Acme",
      slug: "acme-arr-fail",
      pickupUrlToken: "tokenarrived003",
      address: { street: "1", city: "Princeton", state: "NJ", zip: "08540" },
      active: true,
      email: "ops@acme.test",
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

    const getOfficeSpy = vi
      .spyOn(storageMock, "getOffice")
      .mockRejectedValueOnce(new Error("transient failure"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await arriveAtStopAction(stop.id);

    const after = await storageMock.getStop(stop.id);
    expect(after?.arrivedAt).toBeTruthy();
    expect(getSentEmails()).toHaveLength(0);

    getOfficeSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("driver/route server actions — pickupStopAction", () => {
  beforeEach(() => {
    resetStorageMock();
    resetSmsMock();
    resetEmailMock();
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

  it("sends a 'samples picked up' email when office has email AND phone (parallel to SMS)", async () => {
    const office = await storageMock.createOffice({
      name: "Acme Clinic",
      slug: "acme-pu",
      pickupUrlToken: "tokenpicked0001",
      address: { street: "1", city: "Princeton", state: "NJ", zip: "08540" },
      active: true,
      phone: "+15551234567",
      email: "front@acme.test",
    });
    const route = await storageMock.createRoute({
      driverId: "driver-1",
      routeDate: "2026-04-22",
    });
    const request = await storageMock.createPickupRequest({
      officeId: office.id,
      channel: "manual",
      urgency: "routine",
      sampleCount: 5,
    });
    const stop = await storageMock.assignRequestToRoute(route.id, request.id);
    await storageMock.updateRouteStatus(route.id, "active");
    await storageMock.markStopArrived(stop.id);

    await pickupStopAction(stop.id);

    const sms = getSentSms();
    const emails = getSentEmails();
    expect(sms).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toBe("front@acme.test");
    expect(emails[0]?.subject).toBe("Samples picked up from Acme Clinic");
    expect(emails[0]?.textBody).toContain("(5 samples)");
  });

  it("sends only email when office has email but no phone", async () => {
    const office = await storageMock.createOffice({
      name: "Email Only Clinic",
      slug: "email-only",
      pickupUrlToken: "tokenpicked0002",
      address: { street: "1", city: "Princeton", state: "NJ", zip: "08540" },
      active: true,
      email: "ops@onlyemail.test",
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
    expect(getSentEmails()).toHaveLength(1);
  });

  it("email failure does not block SMS or roll back the pickup", async () => {
    const office = await storageMock.createOffice({
      name: "Acme",
      slug: "acme-email-fail",
      pickupUrlToken: "tokenpicked0003",
      address: { street: "1", city: "Princeton", state: "NJ", zip: "08540" },
      active: true,
      phone: "+15551234567",
      email: "ops@acme.test",
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

    const services = (await import("@/interfaces")).getServices();
    const original = services.email.sendEmail;
    services.email.sendEmail = async () => {
      throw new Error("Postmark down");
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await pickupStopAction(stop.id);
      // Pickup persisted
      const after = await storageMock.getStop(stop.id);
      expect(after?.pickedUpAt).toBeTruthy();
      // SMS still went out
      expect(getSentSms()).toHaveLength(1);
    } finally {
      services.email.sendEmail = original;
      errorSpy.mockRestore();
    }
  });
});
