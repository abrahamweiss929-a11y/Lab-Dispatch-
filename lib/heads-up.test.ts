import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HEADS_UP_COPY,
  HEADS_UP_THRESHOLD_SECONDS,
  maybeNotifyOffice,
} from "./heads-up";
import { resetStorageMock, storageMock } from "@/mocks/storage";
import { getSent, resetSmsMock, smsMock } from "@/mocks/sms";
import { mapsMock } from "@/mocks/maps";
import type { OfficeAddress } from "@/lib/types";

const ADDRESS: OfficeAddress = {
  street: "100 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

interface SeedOfficeOpts {
  lat?: number;
  lng?: number;
  phone?: string;
}

async function seedOffice(name: string, opts: SeedOfficeOpts = {}) {
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

async function seedActiveRouteWithStop(
  driverId: string,
  officeId: string | undefined,
) {
  const route = await storageMock.createRoute({
    driverId,
    routeDate: "2026-04-22",
  });
  const request = await storageMock.createPickupRequest({
    officeId,
    channel: "manual",
    urgency: "routine",
  });
  const stop = await storageMock.assignRequestToRoute(route.id, request.id);
  await storageMock.updateRouteStatus(route.id, "active");
  return { route, stop, request };
}

describe("maybeNotifyOffice", () => {
  beforeEach(() => {
    resetStorageMock();
    resetSmsMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies the office when ETA is under threshold and flips the flag", async () => {
    const office = await seedOffice("Acme", {
      lat: 40.0,
      lng: -74.0,
      phone: "(555) 123-4567",
    });
    const { route, stop } = await seedActiveRouteWithStop("driver-1", office.id);
    // Driver is essentially at the office — ETA will be ~0s.
    const outcome = await maybeNotifyOffice({
      driverId: "driver-1",
      routeId: route.id,
      lat: office.lat as number,
      lng: office.lng as number,
    });

    expect(outcome.status).toBe("notified");
    if (outcome.status === "notified") {
      expect(outcome.stopId).toBe(stop.id);
      expect(outcome.etaSeconds).toBeLessThan(HEADS_UP_THRESHOLD_SECONDS);
    }
    const sent = getSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toBe(HEADS_UP_COPY);
    expect(sent[0]?.to).toBe("+15551234567");
    const refreshed = await storageMock.getStop(stop.id);
    expect(refreshed?.notified10min).toBe(true);
  });

  it("skips when ETA is above threshold", async () => {
    const office = await seedOffice("Far", {
      lat: 40.0,
      lng: -74.0,
      phone: "+15551234567",
    });
    const { route, stop } = await seedActiveRouteWithStop("driver-1", office.id);
    // Very far away so the ETA exceeds threshold in the deterministic
    // haversine-based mock.
    const outcome = await maybeNotifyOffice({
      driverId: "driver-1",
      routeId: route.id,
      lat: 35.0,
      lng: -80.0,
    });

    expect(outcome).toEqual({
      status: "skipped",
      reason: "eta_above_threshold",
    });
    expect(getSent()).toHaveLength(0);
    const refreshed = await storageMock.getStop(stop.id);
    expect(refreshed?.notified10min).toBe(false);
  });

  it("skips when the stop is already notified", async () => {
    const office = await seedOffice("Acme", {
      lat: 40.0,
      lng: -74.0,
      phone: "+15551234567",
    });
    const { route, stop } = await seedActiveRouteWithStop("driver-1", office.id);
    await storageMock.markStopNotified10min(stop.id);
    const markSpy = vi.spyOn(storageMock, "markStopNotified10min");

    const outcome = await maybeNotifyOffice({
      driverId: "driver-1",
      routeId: route.id,
      lat: office.lat as number,
      lng: office.lng as number,
    });

    expect(outcome).toEqual({ status: "skipped", reason: "already_notified" });
    expect(getSent()).toHaveLength(0);
    expect(markSpy).not.toHaveBeenCalled();
  });

  it("skips when office has no phone but still marks notified", async () => {
    const office = await seedOffice("NoPhone", { lat: 40.0, lng: -74.0 });
    const { route, stop } = await seedActiveRouteWithStop("driver-1", office.id);

    const outcome = await maybeNotifyOffice({
      driverId: "driver-1",
      routeId: route.id,
      lat: office.lat as number,
      lng: office.lng as number,
    });

    expect(outcome).toEqual({ status: "skipped", reason: "no_office_phone" });
    expect(getSent()).toHaveLength(0);
    const refreshed = await storageMock.getStop(stop.id);
    expect(refreshed?.notified10min).toBe(true);
  });

  it("skips when office has no coords", async () => {
    const office = await seedOffice("NoCoords", { phone: "+15551234567" });
    const { route, stop } = await seedActiveRouteWithStop("driver-1", office.id);

    const outcome = await maybeNotifyOffice({
      driverId: "driver-1",
      routeId: route.id,
      lat: 40.0,
      lng: -74.0,
    });

    expect(outcome).toEqual({ status: "skipped", reason: "no_office_coords" });
    expect(getSent()).toHaveLength(0);
    const refreshed = await storageMock.getStop(stop.id);
    expect(refreshed?.notified10min).toBe(false);
  });

  it("skips when the route is not active (pending)", async () => {
    const route = await storageMock.createRoute({
      driverId: "driver-1",
      routeDate: "2026-04-22",
    });
    const outcome = await maybeNotifyOffice({
      driverId: "driver-1",
      routeId: route.id,
      lat: 40.0,
      lng: -74.0,
    });
    expect(outcome).toEqual({ status: "skipped", reason: "route_not_active" });
  });

  it("skips when route has no pending stops", async () => {
    const office = await seedOffice("Acme", {
      lat: 40.0,
      lng: -74.0,
      phone: "+15551234567",
    });
    const { route, stop } = await seedActiveRouteWithStop("driver-1", office.id);
    await storageMock.markStopArrived(stop.id);
    await storageMock.markStopPickedUp(stop.id);

    const outcome = await maybeNotifyOffice({
      driverId: "driver-1",
      routeId: route.id,
      lat: 40.0,
      lng: -74.0,
    });
    expect(outcome).toEqual({ status: "skipped", reason: "no_next_stop" });
  });

  it("skips when the pickup request has no office", async () => {
    // Route with a stop whose pickup request has officeId = undefined.
    const { route, stop } = await seedActiveRouteWithStop(
      "driver-1",
      undefined,
    );
    expect(stop.notified10min).toBe(false);

    const outcome = await maybeNotifyOffice({
      driverId: "driver-1",
      routeId: route.id,
      lat: 40.0,
      lng: -74.0,
    });
    expect(outcome).toEqual({ status: "skipped", reason: "no_office" });
  });

  it("targets the FIRST pending stop ordered by position", async () => {
    const officeA = await seedOffice("Alpha", {
      lat: 40.0,
      lng: -74.0,
      phone: "+15550000001",
    });
    const officeB = await seedOffice("Bravo", {
      lat: 40.0,
      lng: -74.0,
      phone: "+15550000002",
    });
    const route = await storageMock.createRoute({
      driverId: "driver-1",
      routeDate: "2026-04-22",
    });
    const reqA = await storageMock.createPickupRequest({
      officeId: officeA.id,
      channel: "manual",
      urgency: "routine",
    });
    const reqB = await storageMock.createPickupRequest({
      officeId: officeB.id,
      channel: "manual",
      urgency: "routine",
    });
    const stopA = await storageMock.assignRequestToRoute(route.id, reqA.id);
    const stopB = await storageMock.assignRequestToRoute(route.id, reqB.id);
    await storageMock.updateRouteStatus(route.id, "active");
    // Pick up the first so the "next pending" becomes stop B.
    await storageMock.markStopArrived(stopA.id);
    await storageMock.markStopPickedUp(stopA.id);

    const outcome = await maybeNotifyOffice({
      driverId: "driver-1",
      routeId: route.id,
      lat: officeB.lat as number,
      lng: officeB.lng as number,
    });

    expect(outcome.status).toBe("notified");
    if (outcome.status === "notified") {
      expect(outcome.stopId).toBe(stopB.id);
    }
    const sent = getSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("+15550000002");
  });

  it("returns error outcome when sms.sendSms rejects and does not mark notified", async () => {
    const office = await seedOffice("Acme", {
      lat: 40.0,
      lng: -74.0,
      phone: "+15551234567",
    });
    const { route, stop } = await seedActiveRouteWithStop("driver-1", office.id);
    vi.spyOn(smsMock, "sendSms").mockRejectedValueOnce(new Error("twilio 500"));

    const outcome = await maybeNotifyOffice({
      driverId: "driver-1",
      routeId: route.id,
      lat: office.lat as number,
      lng: office.lng as number,
    });

    expect(outcome.status).toBe("error");
    const refreshed = await storageMock.getStop(stop.id);
    expect(refreshed?.notified10min).toBe(false);
  });

  it("uses the deterministic maps mock for ETA (sanity)", async () => {
    // Kept simple: make sure the mapsMock is what's being consumed and
    // the branch is not somehow shadowed.
    const spy = vi.spyOn(mapsMock, "etaFor");
    const office = await seedOffice("Acme", {
      lat: 40.0,
      lng: -74.0,
      phone: "+15551234567",
    });
    const { route } = await seedActiveRouteWithStop("driver-1", office.id);
    await maybeNotifyOffice({
      driverId: "driver-1",
      routeId: route.id,
      lat: office.lat as number,
      lng: office.lng as number,
    });
    expect(spy).toHaveBeenCalled();
  });
});
