import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertRequestToStop } from "./request-to-stop";
import { resetStorageMock, storageMock } from "@/mocks/storage";
import { mapsMock } from "@/mocks/maps";
import type { OfficeAddress } from "@/lib/types";

const ADDRESS: OfficeAddress = {
  street: "100 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

async function seedOfficeWithCoords(
  name: string,
  lat: number | undefined,
  lng: number | undefined,
) {
  return storageMock.createOffice({
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    pickupUrlToken: `tok-${name.toLowerCase().replace(/\s+/g, "-")}`,
    address: ADDRESS,
    active: true,
    lat,
    lng,
  });
}

async function seedRouteAndRequest(officeId?: string) {
  const driver = await storageMock.createDriver({
    email: "d@test",
    fullName: "Driver",
    active: true,
  });
  const route = await storageMock.createRoute({
    driverId: driver.profileId,
    routeDate: "2026-04-22",
  });
  const request = await storageMock.createPickupRequest({
    officeId,
    channel: "manual",
    urgency: "routine",
  });
  return { route, request };
}

describe("convertRequestToStop", () => {
  beforeEach(() => {
    resetStorageMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates the first stop at position 1 without computing ETA", async () => {
    const office = await seedOfficeWithCoords("Acme", 40.0, -74.0);
    const { route, request } = await seedRouteAndRequest(office.id);
    const etaSpy = vi.spyOn(mapsMock, "etaFor");

    const stop = await convertRequestToStop({
      routeId: route.id,
      requestId: request.id,
    });

    expect(stop.position).toBe(1);
    expect(stop.etaAt).toBeUndefined();
    expect(etaSpy).not.toHaveBeenCalled();
  });

  it("computes etaAt when preceding stop and both offices have coords", async () => {
    const officeA = await seedOfficeWithCoords("Alpha", 40.0, -74.0);
    const officeB = await seedOfficeWithCoords("Bravo", 40.5, -74.5);
    const { route, request } = await seedRouteAndRequest(officeA.id);
    await storageMock.assignRequestToRoute(route.id, request.id);
    const second = await storageMock.createPickupRequest({
      officeId: officeB.id,
      channel: "manual",
      urgency: "routine",
    });

    const fixedNow = new Date("2026-04-22T12:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    // Compute the expected ETA through the real mock to make the
    // assertion self-consistent.
    const { durationSeconds } = await mapsMock.etaFor({
      from: { lat: officeA.lat as number, lng: officeA.lng as number },
      to: { lat: officeB.lat as number, lng: officeB.lng as number },
    });
    const expectedEta = new Date(
      fixedNow + durationSeconds * 1000,
    ).toISOString();

    const stop = await convertRequestToStop({
      routeId: route.id,
      requestId: second.id,
    });

    expect(stop.position).toBe(2);
    expect(stop.etaAt).toBe(expectedEta);
  });

  it("skips ETA when the target office has no coords", async () => {
    const officeA = await seedOfficeWithCoords("Alpha", 40.0, -74.0);
    const officeB = await seedOfficeWithCoords("Bravo", undefined, undefined);
    const { route, request } = await seedRouteAndRequest(officeA.id);
    await storageMock.assignRequestToRoute(route.id, request.id);
    const second = await storageMock.createPickupRequest({
      officeId: officeB.id,
      channel: "manual",
      urgency: "routine",
    });

    const stop = await convertRequestToStop({
      routeId: route.id,
      requestId: second.id,
    });

    expect(stop.etaAt).toBeUndefined();
  });

  it("skips ETA when the preceding office has no coords", async () => {
    const officeA = await seedOfficeWithCoords("Alpha", undefined, undefined);
    const officeB = await seedOfficeWithCoords("Bravo", 40.5, -74.5);
    const { route, request } = await seedRouteAndRequest(officeA.id);
    await storageMock.assignRequestToRoute(route.id, request.id);
    const second = await storageMock.createPickupRequest({
      officeId: officeB.id,
      channel: "manual",
      urgency: "routine",
    });

    const stop = await convertRequestToStop({
      routeId: route.id,
      requestId: second.id,
    });

    expect(stop.etaAt).toBeUndefined();
  });

  it("does not fail assignment when maps.etaFor throws", async () => {
    const officeA = await seedOfficeWithCoords("Alpha", 40.0, -74.0);
    const officeB = await seedOfficeWithCoords("Bravo", 40.5, -74.5);
    const { route, request } = await seedRouteAndRequest(officeA.id);
    await storageMock.assignRequestToRoute(route.id, request.id);
    const second = await storageMock.createPickupRequest({
      officeId: officeB.id,
      channel: "manual",
      urgency: "routine",
    });
    vi.spyOn(mapsMock, "etaFor").mockRejectedValue(new Error("maps down"));
    // Silence the console.error the helper emits on swallow.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const stop = await convertRequestToStop({
      routeId: route.id,
      requestId: second.id,
    });

    expect(stop.etaAt).toBeUndefined();
    // Request should still be flipped to assigned.
    const reqAfter = await storageMock.getPickupRequest(second.id);
    expect(reqAfter?.status).toBe("assigned");
  });

  it("propagates assignRequestToRoute errors (unknown routeId)", async () => {
    await expect(
      convertRequestToStop({
        routeId: "missing-route",
        requestId: "any",
      }),
    ).rejects.toThrow(/route missing-route not found/);
  });
});
