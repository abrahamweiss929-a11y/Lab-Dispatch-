import { describe, it, expect, beforeEach } from "vitest";
import { resetAllMocks } from "@/interfaces";
import { storageMock } from "@/mocks/storage";
import { todayIso } from "@/lib/dates";
import { isSeeded, resetSeedFlag, seedMocks } from "./seed";

describe("seedMocks()", () => {
  beforeEach(() => {
    resetAllMocks();
    resetSeedFlag();
  });

  it("populates expected counts across every table", async () => {
    seedMocks();

    expect(await storageMock.listOffices()).toHaveLength(6);
    expect(await storageMock.listDoctors()).toHaveLength(10);
    expect(await storageMock.listDrivers()).toHaveLength(4);
    expect(await storageMock.listPickupRequests()).toHaveLength(20);
    expect(await storageMock.listMessages()).toHaveLength(5);

    const today = todayIso();
    const todayRoutes = await storageMock.listRoutes({ date: today });
    expect(todayRoutes).toHaveLength(2);

    const active = todayRoutes.find((r) => r.status === "active");
    const pending = todayRoutes.find((r) => r.status === "pending");
    expect(active).toBeDefined();
    expect(pending).toBeDefined();

    if (!active || !pending) throw new Error("unreachable");
    expect(await storageMock.listStops(active.id)).toHaveLength(5);
    expect(await storageMock.listStops(pending.id)).toHaveLength(3);

    const locations = await storageMock.listDriverLocations({
      sinceMinutes: 30,
    });
    // listDriverLocations returns at most one row per driver; we only
    // seed pings for Miguel.
    expect(locations.length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — calling seedMocks() twice does not double counts", async () => {
    seedMocks();
    seedMocks();
    expect(await storageMock.listOffices()).toHaveLength(6);
    expect(await storageMock.listPickupRequests()).toHaveLength(20);
    expect(await storageMock.listDoctors()).toHaveLength(10);
  });

  it("seeds the expected channel distribution (8/6/4/2)", async () => {
    seedMocks();
    const requests = await storageMock.listPickupRequests();
    const byChannel = {
      web: requests.filter((r) => r.channel === "web").length,
      sms: requests.filter((r) => r.channel === "sms").length,
      email: requests.filter((r) => r.channel === "email").length,
      manual: requests.filter((r) => r.channel === "manual").length,
    };
    expect(byChannel).toEqual({ web: 8, sms: 6, email: 4, manual: 2 });
  });

  it("seeds the expected status distribution (6/8/4/2)", async () => {
    seedMocks();
    const requests = await storageMock.listPickupRequests();
    const byStatus = {
      pending: requests.filter((r) => r.status === "pending").length,
      assigned: requests.filter((r) => r.status === "assigned").length,
      completed: requests.filter((r) => r.status === "completed").length,
      flagged: requests.filter((r) => r.status === "flagged").length,
    };
    expect(byStatus).toEqual({
      pending: 6,
      assigned: 8,
      completed: 4,
      flagged: 2,
    });
  });

  it("seeds the expected urgency distribution (14/4/2)", async () => {
    seedMocks();
    const requests = await storageMock.listPickupRequests();
    const byUrgency = {
      routine: requests.filter((r) => r.urgency === "routine").length,
      urgent: requests.filter((r) => r.urgency === "urgent").length,
      stat: requests.filter((r) => r.urgency === "stat").length,
    };
    expect(byUrgency).toEqual({ routine: 14, urgent: 4, stat: 2 });
  });

  it("seeds a phoneless office (Logan Square Cardiology)", async () => {
    seedMocks();
    const offices = await storageMock.listOffices();
    const loganSq = offices.find((o) => o.name === "Logan Square Cardiology");
    expect(loganSq).toBeDefined();
    expect(loganSq?.phone).toBeUndefined();
  });

  it("seeds one soft-deleted office and one soft-deleted driver", async () => {
    seedMocks();
    const inactiveOffices = (await storageMock.listOffices()).filter(
      (o) => !o.active,
    );
    const inactiveDrivers = (await storageMock.listDrivers()).filter(
      (d) => !d.active,
    );
    expect(inactiveOffices).toHaveLength(1);
    expect(inactiveDrivers).toHaveLength(1);
  });

  it("puts Route A on 'active' with partial check-ins (2 completed + 1 on-site + 2 upcoming)", async () => {
    seedMocks();
    const today = todayIso();
    const routes = await storageMock.listRoutes({ date: today });
    const active = routes.find((r) => r.status === "active");
    expect(active).toBeDefined();
    if (!active) throw new Error("unreachable");
    expect(active.startedAt).toBeTruthy();

    const stops = await storageMock.listStops(active.id);
    expect(stops).toHaveLength(5);

    const completed = stops.filter(
      (s) => s.arrivedAt !== undefined && s.pickedUpAt !== undefined,
    );
    const onSite = stops.filter(
      (s) => s.arrivedAt !== undefined && s.pickedUpAt === undefined,
    );
    const upcoming = stops.filter((s) => s.arrivedAt === undefined);
    expect(completed).toHaveLength(2);
    expect(onSite).toHaveLength(1);
    expect(upcoming).toHaveLength(2);
  });

  it("binds Route A's driver to the `driver@test` session userId (`user-driver`)", async () => {
    seedMocks();
    const today = todayIso();
    const routes = await storageMock.listRoutes({ date: today });
    const active = routes.find((r) => r.status === "active");
    expect(active?.driverId).toBe("user-driver");

    const driver = await storageMock.getDriver("user-driver");
    expect(driver?.fullName).toBe("Miguel Ortega");
  });

  it("links 3 of 5 messages to pickup requests", async () => {
    seedMocks();
    const messages = await storageMock.listMessages();
    const linked = messages.filter((m) => m.pickupRequestId !== undefined);
    const orphans = messages.filter((m) => m.pickupRequestId === undefined);
    expect(linked).toHaveLength(3);
    expect(orphans).toHaveLength(2);
  });

  it("sets isSeeded() to true after seeding", () => {
    expect(isSeeded()).toBe(false);
    seedMocks();
    expect(isSeeded()).toBe(true);
    resetSeedFlag();
    expect(isSeeded()).toBe(false);
  });
});
