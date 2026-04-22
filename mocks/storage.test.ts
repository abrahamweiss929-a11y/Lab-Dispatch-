import { describe, it, expect, beforeEach } from "vitest";
import {
  storageMock,
  resetStorageMock,
  getDriverAccount,
  seedDriverLocation,
  seedMessage,
} from "./storage";
import type { OfficeAddress } from "@/lib/types";

const ADDRESS: OfficeAddress = {
  street: "100 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

describe("storageMock", () => {
  beforeEach(() => {
    resetStorageMock();
  });

  it("creates and lists offices (round-trip)", async () => {
    const created = await storageMock.createOffice({
      name: "Acme Clinic",
      slug: "acme-clinic",
      pickupUrlToken: "tok-acme",
      address: ADDRESS,
      active: true,
    });
    expect(created.id).toBeTruthy();
    const listed = await storageMock.listOffices();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
    expect(listed[0]?.name).toBe("Acme Clinic");
    expect(listed[0]?.active).toBe(true);
  });

  it("creates and lists drivers (round-trip)", async () => {
    const created = await storageMock.createDriver({
      email: "alice@test",
      fullName: "Alice Driver",
      phone: "+15551230001",
      active: true,
    });
    expect(typeof created.profileId).toBe("string");
    expect(created.profileId.length).toBeGreaterThan(0);
    expect(created.createdAt).toBeTruthy();
    const listed = await storageMock.listDrivers();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.fullName).toBe("Alice Driver");
  });

  it("createDriver also seeds a mock driver account", async () => {
    const created = await storageMock.createDriver({
      email: "bob@test",
      fullName: "Bob Driver",
      active: true,
    });
    const accounts = await storageMock.listDriverAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toEqual({
      profileId: created.profileId,
      email: "bob@test",
    });
    expect(getDriverAccount(created.profileId)).toEqual({
      email: "bob@test",
      password: "test1234",
    });
  });

  it("creates and lists doctors (round-trip)", async () => {
    const created = await storageMock.createDoctor({
      officeId: "office-1",
      name: "Dr. Smith",
    });
    expect(created.id).toBeTruthy();
    const listed = await storageMock.listDoctors();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it("creates and lists pickup requests (round-trip)", async () => {
    const created = await storageMock.createPickupRequest({
      officeId: "office-1",
      channel: "sms",
      urgency: "routine",
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("pending");
    expect(created.createdAt).toBe(created.updatedAt);

    const all = await storageMock.listPickupRequests();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(created.id);
  });

  it("filters pickup requests by status", async () => {
    const pendingOne = await storageMock.createPickupRequest({
      officeId: "office-1",
      channel: "sms",
      urgency: "routine",
    });
    const pendingTwo = await storageMock.createPickupRequest({
      officeId: "office-1",
      channel: "email",
      urgency: "urgent",
    });
    await storageMock.updatePickupRequestStatus(pendingTwo.id, "completed");

    const pending = await storageMock.listPickupRequests({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(pendingOne.id);

    const completed = await storageMock.listPickupRequests({
      status: "completed",
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]?.id).toBe(pendingTwo.id);
  });

  it("updatePickupRequestStatus rejects when id is missing", async () => {
    await expect(
      storageMock.updatePickupRequestStatus("does-not-exist", "completed"),
    ).rejects.toThrow(/not found/);
  });

  it("updatePickupRequestStatus updates updatedAt but preserves createdAt", async () => {
    const created = await storageMock.createPickupRequest({
      officeId: "office-1",
      channel: "sms",
      urgency: "routine",
    });
    // Ensure clock advances so updatedAt differs.
    await new Promise((r) => setTimeout(r, 5));
    const updated = await storageMock.updatePickupRequestStatus(
      created.id,
      "completed",
    );
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(updated.status).toBe("completed");
  });

  describe("findOfficeBySlugToken", () => {
    it("returns the office on an exact (slug, token) match", async () => {
      const office = await storageMock.createOffice({
        name: "Acme Clinic",
        slug: "acme-clinic",
        pickupUrlToken: "a7b2c3d4e5f6",
        address: ADDRESS,
        active: true,
      });
      const found = await storageMock.findOfficeBySlugToken(
        "acme-clinic",
        "a7b2c3d4e5f6",
      );
      expect(found?.id).toBe(office.id);
    });

    it("returns null when the token does not match", async () => {
      await storageMock.createOffice({
        name: "Acme Clinic",
        slug: "acme-clinic",
        pickupUrlToken: "a7b2c3d4e5f6",
        address: ADDRESS,
        active: true,
      });
      expect(
        await storageMock.findOfficeBySlugToken(
          "acme-clinic",
          "wrongtoken001",
        ),
      ).toBeNull();
    });

    it("returns null when the slug does not match", async () => {
      await storageMock.createOffice({
        name: "Acme Clinic",
        slug: "acme-clinic",
        pickupUrlToken: "a7b2c3d4e5f6",
        address: ADDRESS,
        active: true,
      });
      expect(
        await storageMock.findOfficeBySlugToken(
          "not-acme",
          "a7b2c3d4e5f6",
        ),
      ).toBeNull();
    });

    it("returns null when the office is inactive (even on exact match)", async () => {
      await storageMock.createOffice({
        name: "Old Clinic",
        slug: "old-clinic",
        pickupUrlToken: "deadbeef1234",
        address: ADDRESS,
        active: false,
      });
      expect(
        await storageMock.findOfficeBySlugToken("old-clinic", "deadbeef1234"),
      ).toBeNull();
    });
  });

  it("getDriver / getDoctor / getOffice return null when the id is missing", async () => {
    expect(await storageMock.getDriver("nope")).toBeNull();
    expect(await storageMock.getDoctor("nope")).toBeNull();
    expect(await storageMock.getOffice("nope")).toBeNull();
  });

  it("updateDriver applies a patch, preserves identity fields, and rejects missing ids", async () => {
    const driver = await storageMock.createDriver({
      email: "alice@test",
      fullName: "Alice Driver",
      active: true,
    });
    const createdAt = driver.createdAt;
    const patched = await storageMock.updateDriver(driver.profileId, {
      fullName: "Alice Updated",
      active: false,
    });
    expect(patched.fullName).toBe("Alice Updated");
    expect(patched.active).toBe(false);
    expect(patched.profileId).toBe(driver.profileId);
    expect(patched.createdAt).toBe(createdAt);

    await expect(
      storageMock.updateDriver("missing", { fullName: "x" }),
    ).rejects.toThrow(/not found/);
  });

  it("updateDoctor applies a patch and rejects missing ids", async () => {
    const doctor = await storageMock.createDoctor({
      officeId: "office-1",
      name: "Dr. Smith",
    });
    const patched = await storageMock.updateDoctor(doctor.id, {
      name: "Dr. Jones",
      phone: "+15551112222",
    });
    expect(patched.name).toBe("Dr. Jones");
    expect(patched.phone).toBe("+15551112222");
    expect(patched.officeId).toBe("office-1");

    await expect(
      storageMock.updateDoctor("missing", { name: "x" }),
    ).rejects.toThrow(/not found/);
  });

  it("updateOffice applies a patch and rejects missing ids", async () => {
    const office = await storageMock.createOffice({
      name: "Acme Clinic",
      slug: "acme-clinic",
      pickupUrlToken: "tok-acme",
      address: ADDRESS,
      active: true,
    });
    const patched = await storageMock.updateOffice(office.id, {
      name: "Acme Lab",
      active: false,
    });
    expect(patched.name).toBe("Acme Lab");
    expect(patched.active).toBe(false);
    expect(patched.slug).toBe("acme-clinic");

    await expect(
      storageMock.updateOffice("missing", { name: "x" }),
    ).rejects.toThrow(/not found/);
  });

  it("deleteDoctor removes the row, then getDoctor returns null", async () => {
    const doctor = await storageMock.createDoctor({
      officeId: "office-1",
      name: "Dr. Smith",
    });
    await storageMock.deleteDoctor(doctor.id);
    expect(await storageMock.getDoctor(doctor.id)).toBeNull();
    expect(await storageMock.listDoctors()).toHaveLength(0);
  });

  it("deleteDoctor throws on missing id", async () => {
    await expect(storageMock.deleteDoctor("missing")).rejects.toThrow(
      /not found/,
    );
  });

  it("countAdminDashboard sums correctly across mixed state", async () => {
    await storageMock.createDriver({
      email: "a@test",
      fullName: "A",
      active: true,
    });
    await storageMock.createDriver({
      email: "b@test",
      fullName: "B",
      active: false,
    });

    await storageMock.createDoctor({ officeId: "o1", name: "Dr A" });
    await storageMock.createDoctor({ officeId: "o1", name: "Dr B" });
    await storageMock.createDoctor({ officeId: "o1", name: "Dr C" });

    await storageMock.createOffice({
      name: "Active Office",
      slug: "active-office",
      pickupUrlToken: "tok-1",
      address: ADDRESS,
      active: true,
    });
    await storageMock.createOffice({
      name: "Inactive Office",
      slug: "inactive-office",
      pickupUrlToken: "tok-2",
      address: ADDRESS,
      active: false,
    });

    await storageMock.createPickupRequest({
      officeId: "o1",
      channel: "sms",
      urgency: "routine",
    });
    await storageMock.createPickupRequest({
      officeId: "o1",
      channel: "sms",
      urgency: "routine",
    });
    const third = await storageMock.createPickupRequest({
      officeId: "o1",
      channel: "sms",
      urgency: "routine",
    });
    await storageMock.updatePickupRequestStatus(third.id, "completed");

    expect(await storageMock.countAdminDashboard()).toEqual({
      drivers: 2,
      doctors: 3,
      offices: 2,
      pendingPickupRequests: 2,
    });
  });

  describe("updatePickupRequestStatus (flaggedReason)", () => {
    it("stores flaggedReason when transitioning to flagged", async () => {
      const req = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "sms",
        urgency: "routine",
      });
      const flagged = await storageMock.updatePickupRequestStatus(
        req.id,
        "flagged",
        "missing samples",
      );
      expect(flagged.status).toBe("flagged");
      expect(flagged.flaggedReason).toBe("missing samples");
    });

    it("clears flaggedReason when status transitions away from flagged", async () => {
      const req = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "sms",
        urgency: "routine",
      });
      await storageMock.updatePickupRequestStatus(
        req.id,
        "flagged",
        "needs review",
      );
      const cleared = await storageMock.updatePickupRequestStatus(
        req.id,
        "completed",
      );
      expect(cleared.status).toBe("completed");
      expect(cleared.flaggedReason).toBeUndefined();
    });
  });

  describe("routes CRUD", () => {
    it("createRoute returns a pending route", async () => {
      const route = await storageMock.createRoute({
        driverId: "driver-1",
        routeDate: "2026-04-22",
      });
      expect(route.id).toBeTruthy();
      expect(route.status).toBe("pending");
      expect(route.routeDate).toBe("2026-04-22");
    });

    it("listRoutes filters by date / driverId / status", async () => {
      const a = await storageMock.createRoute({
        driverId: "d1",
        routeDate: "2026-04-22",
      });
      const b = await storageMock.createRoute({
        driverId: "d2",
        routeDate: "2026-04-22",
      });
      const c = await storageMock.createRoute({
        driverId: "d1",
        routeDate: "2026-04-23",
      });
      await storageMock.updateRouteStatus(b.id, "active");

      expect((await storageMock.listRoutes({})).map((r) => r.id).sort()).toEqual(
        [a.id, b.id, c.id].sort(),
      );
      expect(
        (await storageMock.listRoutes({ date: "2026-04-22" }))
          .map((r) => r.id)
          .sort(),
      ).toEqual([a.id, b.id].sort());
      expect(
        (await storageMock.listRoutes({ driverId: "d1" }))
          .map((r) => r.id)
          .sort(),
      ).toEqual([a.id, c.id].sort());
      expect(
        (await storageMock.listRoutes({ status: "active" })).map((r) => r.id),
      ).toEqual([b.id]);
    });

    it("getRoute returns null for missing ids", async () => {
      expect(await storageMock.getRoute("missing")).toBeNull();
    });

    it("updateRouteStatus transitions set and clear timestamps", async () => {
      const route = await storageMock.createRoute({
        driverId: "d1",
        routeDate: "2026-04-22",
      });
      const started = await storageMock.updateRouteStatus(route.id, "active");
      expect(started.startedAt).toBeTruthy();
      const completed = await storageMock.updateRouteStatus(
        route.id,
        "completed",
      );
      expect(completed.completedAt).toBeTruthy();
      expect(completed.startedAt).toBe(started.startedAt);
      const reset = await storageMock.updateRouteStatus(route.id, "pending");
      expect(reset.startedAt).toBeUndefined();
      expect(reset.completedAt).toBeUndefined();
    });

    it("updateRouteStatus throws on missing id", async () => {
      await expect(
        storageMock.updateRouteStatus("missing", "active"),
      ).rejects.toThrow(/not found/);
    });
  });

  describe("stops", () => {
    async function setupRouteAndRequest() {
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
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      return { route, request };
    }

    it("assignRequestToRoute appends a stop and flips the request to assigned", async () => {
      const { route, request } = await setupRouteAndRequest();
      const stop = await storageMock.assignRequestToRoute(route.id, request.id);
      expect(stop.position).toBe(1);

      const second = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      const stop2 = await storageMock.assignRequestToRoute(route.id, second.id);
      expect(stop2.position).toBe(2);

      const reqAfter = (await storageMock.listPickupRequests()).find(
        (r) => r.id === request.id,
      );
      expect(reqAfter?.status).toBe("assigned");
    });

    it("assignRequestToRoute initializes notified10min to false", async () => {
      const { route, request } = await setupRouteAndRequest();
      const stop = await storageMock.assignRequestToRoute(
        route.id,
        request.id,
      );
      expect(stop.notified10min).toBe(false);
      const refreshed = await storageMock.getStop(stop.id);
      expect(refreshed?.notified10min).toBe(false);
    });

    it("assignRequestToRoute throws with an explicit position that collides", async () => {
      const { route, request } = await setupRouteAndRequest();
      await storageMock.assignRequestToRoute(route.id, request.id);
      const other = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      await expect(
        storageMock.assignRequestToRoute(route.id, other.id, 1),
      ).rejects.toThrow(/position 1 already exists/);
    });

    it("assignRequestToRoute rejects missing route / request / already-assigned", async () => {
      const { route, request } = await setupRouteAndRequest();
      await expect(
        storageMock.assignRequestToRoute("missing-route", request.id),
      ).rejects.toThrow(/route missing-route not found/);
      await expect(
        storageMock.assignRequestToRoute(route.id, "missing-req"),
      ).rejects.toThrow(/pickup request missing-req not found/);
      await storageMock.assignRequestToRoute(route.id, request.id);
      await expect(
        storageMock.assignRequestToRoute(route.id, request.id),
      ).rejects.toThrow(/already assigned/);
    });

    it("listStops returns positions in order, empty when no stops", async () => {
      const { route, request } = await setupRouteAndRequest();
      expect(await storageMock.listStops(route.id)).toHaveLength(0);
      await storageMock.assignRequestToRoute(route.id, request.id);
      const stops = await storageMock.listStops(route.id);
      expect(stops).toHaveLength(1);
      expect(stops[0]?.position).toBe(1);
    });

    it("removeStopFromRoute deletes, re-numbers, and reopens the pickup request", async () => {
      const { route, request } = await setupRouteAndRequest();
      const req2 = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      const req3 = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      const s1 = await storageMock.assignRequestToRoute(route.id, request.id);
      await storageMock.assignRequestToRoute(route.id, req2.id);
      await storageMock.assignRequestToRoute(route.id, req3.id);

      await storageMock.removeStopFromRoute(s1.id);

      const remaining = await storageMock.listStops(route.id);
      expect(remaining).toHaveLength(2);
      expect(remaining.map((s) => s.position)).toEqual([1, 2]);
      const reopened = (await storageMock.listPickupRequests()).find(
        (r) => r.id === request.id,
      );
      expect(reopened?.status).toBe("pending");
      expect(reopened?.flaggedReason).toBeUndefined();
    });

    it("removeStopFromRoute throws on missing stop id", async () => {
      await expect(
        storageMock.removeStopFromRoute("missing"),
      ).rejects.toThrow(/stop missing not found/);
    });

    it("reorderStops rewrites positions in the given order", async () => {
      const { route, request } = await setupRouteAndRequest();
      const r2 = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      const r3 = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      const s1 = await storageMock.assignRequestToRoute(route.id, request.id);
      const s2 = await storageMock.assignRequestToRoute(route.id, r2.id);
      const s3 = await storageMock.assignRequestToRoute(route.id, r3.id);

      await storageMock.reorderStops(route.id, [s3.id, s1.id, s2.id]);

      const ordered = await storageMock.listStops(route.id);
      expect(ordered.map((s) => s.id)).toEqual([s3.id, s1.id, s2.id]);
      expect(ordered.map((s) => s.position)).toEqual([1, 2, 3]);
    });

    it("reorderStops throws on length mismatch / missing ids / cross-route ids", async () => {
      const { route, request } = await setupRouteAndRequest();
      const s1 = await storageMock.assignRequestToRoute(route.id, request.id);

      await expect(
        storageMock.reorderStops(route.id, [s1.id, "extra"]),
      ).rejects.toThrow(/length does not match/);

      await expect(
        storageMock.reorderStops(route.id, ["missing"]),
      ).rejects.toThrow(/stop missing not found/);

      const otherRoute = await storageMock.createRoute({
        driverId: "d2",
        routeDate: "2026-04-22",
      });
      const req2 = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      const stopOther = await storageMock.assignRequestToRoute(
        otherRoute.id,
        req2.id,
      );
      await expect(
        storageMock.reorderStops(route.id, [stopOther.id]),
      ).rejects.toThrow(/does not belong to route/);
    });

    it("reorderStops throws when the route is unknown", async () => {
      await expect(
        storageMock.reorderStops("missing-route", []),
      ).rejects.toThrow(/route missing-route not found/);
    });
  });

  describe("stop check-ins", () => {
    async function seedStopRow() {
      const driver = await storageMock.createDriver({
        email: "dd@test",
        fullName: "Driver",
        active: true,
      });
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2026-04-22",
      });
      const request = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      const stop = await storageMock.assignRequestToRoute(
        route.id,
        request.id,
      );
      return { stop };
    }

    it("getStop returns the seeded stop", async () => {
      const { stop } = await seedStopRow();
      const found = await storageMock.getStop(stop.id);
      expect(found?.id).toBe(stop.id);
    });

    it("getStop returns null on unknown id", async () => {
      expect(await storageMock.getStop("missing")).toBeNull();
    });

    it("markStopArrived sets arrivedAt on the happy path", async () => {
      const { stop } = await seedStopRow();
      const updated = await storageMock.markStopArrived(stop.id);
      expect(updated.arrivedAt).toBeTruthy();
      const refreshed = await storageMock.getStop(stop.id);
      expect(refreshed?.arrivedAt).toBe(updated.arrivedAt);
    });

    it("markStopArrived throws on missing id", async () => {
      await expect(storageMock.markStopArrived("missing")).rejects.toThrow(
        /stop missing not found/,
      );
    });

    it("markStopArrived throws when already arrived", async () => {
      const { stop } = await seedStopRow();
      await storageMock.markStopArrived(stop.id);
      await expect(storageMock.markStopArrived(stop.id)).rejects.toThrow(
        /already arrived/,
      );
    });

    it("markStopPickedUp sets pickedUpAt after arrival", async () => {
      const { stop } = await seedStopRow();
      await storageMock.markStopArrived(stop.id);
      const updated = await storageMock.markStopPickedUp(stop.id);
      expect(updated.pickedUpAt).toBeTruthy();
    });

    it("markStopPickedUp throws on missing id", async () => {
      await expect(storageMock.markStopPickedUp("missing")).rejects.toThrow(
        /stop missing not found/,
      );
    });

    it("markStopPickedUp throws when not yet arrived", async () => {
      const { stop } = await seedStopRow();
      await expect(storageMock.markStopPickedUp(stop.id)).rejects.toThrow(
        /not yet arrived/,
      );
    });

    it("markStopPickedUp throws when already picked up", async () => {
      const { stop } = await seedStopRow();
      await storageMock.markStopArrived(stop.id);
      await storageMock.markStopPickedUp(stop.id);
      await expect(storageMock.markStopPickedUp(stop.id)).rejects.toThrow(
        /already picked up/,
      );
    });

    it("markStopNotified10min flips the flag on the happy path", async () => {
      const { stop } = await seedStopRow();
      expect(stop.notified10min).toBe(false);
      const updated = await storageMock.markStopNotified10min(stop.id);
      expect(updated.notified10min).toBe(true);
      const refreshed = await storageMock.getStop(stop.id);
      expect(refreshed?.notified10min).toBe(true);
    });

    it("markStopNotified10min is idempotent when already notified", async () => {
      const { stop } = await seedStopRow();
      await storageMock.markStopNotified10min(stop.id);
      const again = await storageMock.markStopNotified10min(stop.id);
      expect(again.notified10min).toBe(true);
      expect(again.id).toBe(stop.id);
    });

    it("markStopNotified10min throws on missing id", async () => {
      await expect(
        storageMock.markStopNotified10min("missing"),
      ).rejects.toThrow(/stop missing not found/);
    });

    it("updateStopEta overwrites etaAt on the happy path", async () => {
      const { stop } = await seedStopRow();
      const when = "2026-04-22T15:30:00.000Z";
      const updated = await storageMock.updateStopEta(stop.id, when);
      expect(updated.etaAt).toBe(when);
      const refreshed = await storageMock.getStop(stop.id);
      expect(refreshed?.etaAt).toBe(when);
    });

    it("updateStopEta throws on missing id", async () => {
      await expect(
        storageMock.updateStopEta("missing", "2026-04-22T15:30:00.000Z"),
      ).rejects.toThrow(/stop missing not found/);
    });
  });

  describe("getPickupRequest", () => {
    it("returns the seeded request", async () => {
      const created = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      const found = await storageMock.getPickupRequest(created.id);
      expect(found?.id).toBe(created.id);
    });

    it("returns null on unknown id", async () => {
      expect(await storageMock.getPickupRequest("missing")).toBeNull();
    });
  });

  describe("recordDriverLocation", () => {
    it("appends a row that listDriverLocations can see", async () => {
      const row = await storageMock.recordDriverLocation({
        driverId: "d1",
        routeId: "r1",
        lat: 40.7,
        lng: -74.0,
      });
      expect(row.id).toBeTruthy();
      expect(row.driverId).toBe("d1");
      expect(row.routeId).toBe("r1");
      expect(row.lat).toBe(40.7);
      expect(row.lng).toBe(-74.0);

      const fresh = await storageMock.listDriverLocations({ sinceMinutes: 1 });
      expect(fresh.map((l) => l.driverId)).toContain("d1");
    });

    it("defaults recordedAt to a near-now timestamp when omitted", async () => {
      const before = Date.now();
      const row = await storageMock.recordDriverLocation({
        driverId: "d1",
        lat: 1,
        lng: 1,
      });
      const ts = Date.parse(row.recordedAt);
      expect(Math.abs(ts - before)).toBeLessThan(5_000);
    });

    it("preserves an explicit recordedAt", async () => {
      const when = "2026-04-22T12:34:56.000Z";
      const row = await storageMock.recordDriverLocation({
        driverId: "d1",
        lat: 1,
        lng: 1,
        recordedAt: when,
      });
      expect(row.recordedAt).toBe(when);
    });
  });

  describe("listDriverLocations", () => {
    it("returns at most one fresh row per driver, latest first", async () => {
      const now = Date.now();
      const iso = (offsetMs: number) =>
        new Date(now + offsetMs).toISOString();
      seedDriverLocation({
        id: "1",
        driverId: "d1",
        lat: 1,
        lng: 1,
        recordedAt: iso(-10 * 60_000),
      });
      seedDriverLocation({
        id: "2",
        driverId: "d1",
        lat: 2,
        lng: 2,
        recordedAt: iso(-5 * 60_000),
      });
      seedDriverLocation({
        id: "3",
        driverId: "d2",
        lat: 3,
        lng: 3,
        recordedAt: iso(-2 * 60_000),
      });
      seedDriverLocation({
        id: "4",
        driverId: "d3",
        lat: 4,
        lng: 4,
        recordedAt: iso(-60 * 60_000), // stale — outside 15-min window
      });

      const fresh = await storageMock.listDriverLocations();
      expect(fresh.map((l) => l.id)).toEqual(["3", "2"]);
    });

    it("returns empty when no locations seeded", async () => {
      expect(await storageMock.listDriverLocations()).toEqual([]);
    });

    it("respects sinceMinutes", async () => {
      const now = Date.now();
      seedDriverLocation({
        id: "1",
        driverId: "d1",
        lat: 1,
        lng: 1,
        recordedAt: new Date(now - 30 * 60_000).toISOString(),
      });
      expect(await storageMock.listDriverLocations({ sinceMinutes: 60 }))
        .toHaveLength(1);
      expect(await storageMock.listDriverLocations({ sinceMinutes: 10 }))
        .toHaveLength(0);
    });
  });

  describe("listMessages", () => {
    it("returns all when no filter, sorted by receivedAt desc", async () => {
      seedMessage({
        id: "m1",
        channel: "sms",
        fromIdentifier: "+1",
        body: "a",
        receivedAt: "2026-04-22T10:00:00Z",
      });
      seedMessage({
        id: "m2",
        channel: "sms",
        fromIdentifier: "+2",
        body: "b",
        receivedAt: "2026-04-22T12:00:00Z",
      });
      const all = await storageMock.listMessages();
      expect(all.map((m) => m.id)).toEqual(["m2", "m1"]);
    });

    it("flagged: true includes orphans and flagged-linked", async () => {
      const linked = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "sms",
        urgency: "routine",
      });
      await storageMock.updatePickupRequestStatus(
        linked.id,
        "flagged",
        "review",
      );
      const ok = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "sms",
        urgency: "routine",
      });

      seedMessage({
        id: "orphan",
        channel: "sms",
        fromIdentifier: "+unknown",
        body: "who",
        receivedAt: "2026-04-22T10:00:00Z",
      });
      seedMessage({
        id: "flagged-linked",
        channel: "sms",
        fromIdentifier: "+known",
        body: "hey",
        receivedAt: "2026-04-22T11:00:00Z",
        pickupRequestId: linked.id,
      });
      seedMessage({
        id: "clean-linked",
        channel: "sms",
        fromIdentifier: "+ok",
        body: "hi",
        receivedAt: "2026-04-22T12:00:00Z",
        pickupRequestId: ok.id,
      });

      const flagged = await storageMock.listMessages({ flagged: true });
      expect(flagged.map((m) => m.id).sort()).toEqual(
        ["flagged-linked", "orphan"].sort(),
      );
    });
  });

  describe("createMessage", () => {
    it("inserts a message and returns the stored record", async () => {
      const record = await storageMock.createMessage({
        channel: "sms",
        fromIdentifier: "+15550001111",
        body: "pickup please",
      });
      expect(record.id).toBeTruthy();
      expect(record.channel).toBe("sms");
      expect(record.fromIdentifier).toBe("+15550001111");
      expect(record.body).toBe("pickup please");
      expect(record.receivedAt).toBeTruthy();
      expect(record.pickupRequestId).toBeUndefined();

      const all = await storageMock.listMessages();
      expect(all).toHaveLength(1);
      expect(all[0]?.id).toBe(record.id);
    });

    it("preserves an explicit receivedAt and subject", async () => {
      const when = "2026-04-22T10:00:00.000Z";
      const record = await storageMock.createMessage({
        channel: "email",
        fromIdentifier: "front@acme.test",
        subject: "Pickup",
        body: "body",
        receivedAt: when,
      });
      expect(record.receivedAt).toBe(when);
      expect(record.subject).toBe("Pickup");
    });
  });

  describe("findOfficeByPhone", () => {
    it("matches after normalization on BOTH sides", async () => {
      const office = await storageMock.createOffice({
        name: "Acme Clinic",
        slug: "acme-clinic",
        pickupUrlToken: "a1b2c3d4e5f6",
        address: ADDRESS,
        active: true,
        phone: "(555) 123-4567",
      });
      const found = await storageMock.findOfficeByPhone("+15551234567");
      expect(found?.id).toBe(office.id);
    });

    it("returns null on wrong number", async () => {
      await storageMock.createOffice({
        name: "Acme Clinic",
        slug: "acme-clinic",
        pickupUrlToken: "a1b2c3d4e5f6",
        address: ADDRESS,
        active: true,
        phone: "(555) 123-4567",
      });
      expect(await storageMock.findOfficeByPhone("+15559999999")).toBeNull();
    });

    it("returns null when the matching office is inactive", async () => {
      await storageMock.createOffice({
        name: "Old Clinic",
        slug: "old-clinic",
        pickupUrlToken: "deadbeef1234",
        address: ADDRESS,
        active: false,
        phone: "+15551234567",
      });
      expect(await storageMock.findOfficeByPhone("+15551234567")).toBeNull();
    });

    it("returns null when the input cannot be normalized", async () => {
      await storageMock.createOffice({
        name: "Acme Clinic",
        slug: "acme-clinic",
        pickupUrlToken: "a1b2c3d4e5f6",
        address: ADDRESS,
        active: true,
        phone: "+15551234567",
      });
      expect(await storageMock.findOfficeByPhone("abc")).toBeNull();
    });
  });

  describe("findOfficeByEmail", () => {
    it("matches case-insensitively after trimming", async () => {
      const office = await storageMock.createOffice({
        name: "Acme Clinic",
        slug: "acme-clinic",
        pickupUrlToken: "a1b2c3d4e5f6",
        address: ADDRESS,
        active: true,
        email: "Front-Desk@Acme.Test",
      });
      const found = await storageMock.findOfficeByEmail(
        "  front-desk@acme.test  ",
      );
      expect(found?.id).toBe(office.id);
    });

    it("returns null on a different address", async () => {
      await storageMock.createOffice({
        name: "Acme Clinic",
        slug: "acme-clinic",
        pickupUrlToken: "a1b2c3d4e5f6",
        address: ADDRESS,
        active: true,
        email: "front-desk@acme.test",
      });
      expect(
        await storageMock.findOfficeByEmail("someone@else.test"),
      ).toBeNull();
    });

    it("returns null when the matching office is inactive", async () => {
      await storageMock.createOffice({
        name: "Old Clinic",
        slug: "old-clinic",
        pickupUrlToken: "deadbeef1234",
        address: ADDRESS,
        active: false,
        email: "old@clinic.test",
      });
      expect(await storageMock.findOfficeByEmail("old@clinic.test")).toBeNull();
    });
  });

  describe("linkMessageToRequest", () => {
    it("links a message to a pickup request id", async () => {
      const msg = await storageMock.createMessage({
        channel: "sms",
        fromIdentifier: "+15550001111",
        body: "hi",
      });
      const linked = await storageMock.linkMessageToRequest(msg.id, "req-1");
      expect(linked.pickupRequestId).toBe("req-1");
      const all = await storageMock.listMessages();
      expect(all[0]?.pickupRequestId).toBe("req-1");
    });

    it("throws on unknown messageId", async () => {
      await expect(
        storageMock.linkMessageToRequest("missing", "req-1"),
      ).rejects.toThrow(/message missing not found/);
    });

    it("throws when the message is already linked to a different id", async () => {
      const msg = await storageMock.createMessage({
        channel: "sms",
        fromIdentifier: "+15550001111",
        body: "hi",
      });
      await storageMock.linkMessageToRequest(msg.id, "req-1");
      await expect(
        storageMock.linkMessageToRequest(msg.id, "req-2"),
      ).rejects.toThrow(/already linked/);
    });

    it("is idempotent when re-linking to the same id", async () => {
      const msg = await storageMock.createMessage({
        channel: "sms",
        fromIdentifier: "+15550001111",
        body: "hi",
      });
      await storageMock.linkMessageToRequest(msg.id, "req-1");
      const again = await storageMock.linkMessageToRequest(msg.id, "req-1");
      expect(again.pickupRequestId).toBe("req-1");
    });
  });

  describe("createRequestFromMessage", () => {
    it("creates a pending request with channel / sourceIdentifier / rawMessage", async () => {
      seedMessage({
        id: "m1",
        channel: "email",
        fromIdentifier: "foo@bar",
        subject: "pickup please",
        body: "body text",
        receivedAt: "2026-04-22T10:00:00Z",
      });
      const req = await storageMock.createRequestFromMessage("m1");
      expect(req.status).toBe("pending");
      expect(req.channel).toBe("email");
      expect(req.sourceIdentifier).toBe("foo@bar");
      expect(req.rawMessage).toBe("body text");
      expect(req.urgency).toBe("routine");

      const messages = await storageMock.listMessages();
      expect(messages[0]?.pickupRequestId).toBe(req.id);
    });

    it("throws on missing id", async () => {
      await expect(
        storageMock.createRequestFromMessage("missing"),
      ).rejects.toThrow(/not found/);
    });

    it("throws when the message is already linked", async () => {
      seedMessage({
        id: "m1",
        channel: "sms",
        fromIdentifier: "+1",
        body: "x",
        receivedAt: "2026-04-22T10:00:00Z",
        pickupRequestId: "already",
      });
      await expect(
        storageMock.createRequestFromMessage("m1"),
      ).rejects.toThrow(/already linked/);
    });
  });

  describe("countDispatcherDashboard", () => {
    it("sums correctly across mixed state", async () => {
      // pending pickup request (any date)
      await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      // completed request — excluded from pending
      const completed = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      await storageMock.updatePickupRequestStatus(completed.id, "completed");

      // today-dated route (pending)
      const driver = await storageMock.createDriver({
        email: "d@test",
        fullName: "D",
        active: true,
      });
      const routeToday = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2026-04-22",
      });
      const reqForStop = await storageMock.createPickupRequest({
        officeId: "o1",
        channel: "manual",
        urgency: "routine",
      });
      await storageMock.assignRequestToRoute(routeToday.id, reqForStop.id);

      // active route on another date
      const routeOther = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2026-04-23",
      });
      await storageMock.updateRouteStatus(routeOther.id, "active");

      // orphan message → counts as flagged
      seedMessage({
        id: "orphan",
        channel: "sms",
        fromIdentifier: "+1",
        body: "x",
        receivedAt: "2026-04-22T10:00:00Z",
      });

      const counts = await storageMock.countDispatcherDashboard("2026-04-22");
      expect(counts).toEqual({
        pendingRequests: 1, // initial one is now the only remaining pending (reqForStop flipped to assigned)
        todayStops: 1,
        activeRoutes: 1,
        flaggedMessages: 1,
      });
    });
  });
});
