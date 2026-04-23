import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeFakeSupabase, type FakeSupabase } from "@/tests/helpers/fake-supabase";

// `vi.mock` is hoisted to the top of the file before `import` runs.
// The factory can only reference modules or `vi.hoisted` values —
// referencing outer file locals would hit the TDZ. We stash the holder
// on `vi.hoisted` so the factory closes over it safely.
const hoisted = vi.hoisted(() => {
  return {
    holder: { current: null as unknown as FakeSupabase | null },
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => hoisted.holder.current),
}));

import type { StorageService } from "./storage";

let fakeClient: FakeSupabase;
let storage: StorageService;

describe("createRealStorageService() — per-method coverage against fake Supabase", () => {
  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    // Force a fresh module load so the `createClient` binding inside
    // `supabase-client.ts` re-resolves against the mocked module each
    // test (the vitest setup file preloads the graph with the real
    // supabase-js before this file's vi.mock registers).
    vi.resetModules();
    const clientMod = await import("./supabase-client");
    clientMod.__resetSupabaseAdminClient();
    fakeClient = makeFakeSupabase();
    hoisted.holder.current = fakeClient;
    const realMod = await import("./storage.real");
    storage = realMod.createRealStorageService();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const clientMod = await import("./supabase-client");
    clientMod.__resetSupabaseAdminClient();
  });

  // ---- Offices --------------------------------------------------------

  describe("offices", () => {
    it("listOffices maps rows and orders by name", async () => {
      fakeClient.__enqueue("offices", "select", {
        data: [
          {
            id: "o1",
            name: "A",
            slug: "a",
            pickup_url_token: "t1",
            phone: null,
            email: null,
            address_street: null,
            address_city: null,
            address_state: null,
            address_zip: null,
            lat: null,
            lng: null,
            active: true,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      });
      const result = await storage.listOffices();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("o1");
      const calls = fakeClient.__calls();
      expect(calls[0]).toMatchObject({ table: "offices", method: "select" });
      expect(calls.some((c) => c.method === "order")).toBe(true);
    });

    it("listOffices throws wrapped error on PostgREST failure", async () => {
      fakeClient.__enqueue("offices", "select", {
        data: null,
        error: { code: "PGRST301", message: "nope" },
      });
      await expect(storage.listOffices()).rejects.toThrow(/listOffices failed/);
    });

    it("getOffice returns null on no match", async () => {
      fakeClient.__enqueue("offices", "select", { data: null, error: null });
      const result = await storage.getOffice("missing");
      expect(result).toBeNull();
    });

    it("getOffice maps a found row", async () => {
      fakeClient.__enqueue("offices", "select", {
        data: {
          id: "o1",
          name: "X",
          slug: "x",
          pickup_url_token: "t",
          phone: null,
          email: null,
          address_street: null,
          address_city: null,
          address_state: null,
          address_zip: null,
          lat: null,
          lng: null,
          active: true,
          created_at: "2026-01-01T00:00:00Z",
        },
        error: null,
      });
      const result = await storage.getOffice("o1");
      expect(result?.id).toBe("o1");
    });

    it("findOfficeBySlugToken applies slug, token, and active=true filters", async () => {
      fakeClient.__enqueue("offices", "select", { data: null, error: null });
      await storage.findOfficeBySlugToken("slug-x", "tok1");
      const calls = fakeClient.__calls().filter((c) => c.method === "eq");
      const eqArgs = calls.map((c) => c.args[0]);
      expect(eqArgs).toContain("slug");
      expect(eqArgs).toContain("pickup_url_token");
      expect(eqArgs).toContain("active");
    });

    it("createOffice inserts with mapped fields and returns domain row", async () => {
      fakeClient.__enqueue("offices", "insert", {
        data: {
          id: "new-id",
          name: "N",
          slug: "n",
          pickup_url_token: "t1",
          phone: null,
          email: null,
          address_street: "1 M",
          address_city: "C",
          address_state: "S",
          address_zip: "1",
          lat: null,
          lng: null,
          active: true,
          created_at: "2026-01-01T00:00:00Z",
        },
        error: null,
      });
      const office = await storage.createOffice({
        name: "N",
        slug: "n",
        pickupUrlToken: "t1",
        address: { street: "1 M", city: "C", state: "S", zip: "1" },
        active: true,
      });
      expect(office.id).toBe("new-id");
    });

    it("updateOffice throws office-not-found when maybeSingle returns null", async () => {
      fakeClient.__enqueue("offices", "update", { data: null, error: null });
      await expect(
        storage.updateOffice("missing", { name: "X" }),
      ).rejects.toThrow(/office missing not found/);
    });

    it("findOfficeByPhone falls back to full scan when exact match misses", async () => {
      fakeClient.__enqueue("offices", "select", { data: null, error: null });
      fakeClient.__enqueue("offices", "select", {
        data: [
          {
            id: "o1",
            name: "Matches on loose format",
            slug: "x",
            pickup_url_token: "t",
            phone: "(555) 123-4567",
            email: null,
            address_street: null,
            address_city: null,
            address_state: null,
            address_zip: null,
            lat: null,
            lng: null,
            active: true,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      });
      const office = await storage.findOfficeByPhone("+15551234567");
      expect(office?.id).toBe("o1");
    });

    it("findOfficeByPhone returns null for unnormalizable input without calling DB", async () => {
      const result = await storage.findOfficeByPhone("garbage");
      expect(result).toBeNull();
      expect(fakeClient.__calls()).toHaveLength(0);
    });

    it("findOfficeByEmail uses ilike + active filter", async () => {
      fakeClient.__enqueue("offices", "select", { data: null, error: null });
      await storage.findOfficeByEmail("Front@Test.Lab  ");
      const calls = fakeClient.__calls();
      expect(calls.some((c) => c.method === "ilike" && c.args[0] === "email")).toBe(
        true,
      );
      expect(
        calls.some((c) => c.method === "eq" && c.args[0] === "active"),
      ).toBe(true);
    });

    it("findOfficeByEmail returns null for empty input without calling DB", async () => {
      const result = await storage.findOfficeByEmail("   ");
      expect(result).toBeNull();
      expect(fakeClient.__calls()).toHaveLength(0);
    });
  });

  // ---- Drivers --------------------------------------------------------

  describe("drivers", () => {
    it("listDrivers maps joined profiles fields", async () => {
      fakeClient.__enqueue("drivers", "select", {
        data: [
          {
            profile_id: "p1",
            vehicle_label: "Van",
            active: true,
            created_at: "2026-01-01T00:00:00Z",
            profiles: { full_name: "Miguel", phone: "+15551110000" },
          },
        ],
        error: null,
      });
      const drivers = await storage.listDrivers();
      expect(drivers[0].fullName).toBe("Miguel");
      expect(drivers[0].phone).toBe("+15551110000");
    });

    it("getDriver returns null when not found", async () => {
      fakeClient.__enqueue("drivers", "select", { data: null, error: null });
      const d = await storage.getDriver("missing");
      expect(d).toBeNull();
    });

    it("createDriver throws a scoped auth-adapter-required error", async () => {
      await expect(
        storage.createDriver({
          fullName: "X",
          email: "x@x.test",
          active: true,
        }),
      ).rejects.toThrow(/requires the Supabase auth adapter/);
      // No DB calls were made.
      expect(fakeClient.__calls()).toHaveLength(0);
    });

    it("updateDriver applies profile patch and driver patch, then reads back", async () => {
      fakeClient.__enqueue("profiles", "update", { data: null, error: null });
      fakeClient.__enqueue("drivers", "update", { data: null, error: null });
      fakeClient.__enqueue("drivers", "select", {
        data: {
          profile_id: "p1",
          vehicle_label: "Van-9",
          active: true,
          created_at: "2026-01-01T00:00:00Z",
          profiles: { full_name: "Miguel Jr.", phone: "+15552223333" },
        },
        error: null,
      });
      const d = await storage.updateDriver("p1", {
        fullName: "Miguel Jr.",
        vehicleLabel: "Van-9",
      });
      expect(d.fullName).toBe("Miguel Jr.");
    });

    it("updateDriver throws when refreshed driver is null", async () => {
      fakeClient.__enqueue("profiles", "update", { data: null, error: null });
      fakeClient.__enqueue("drivers", "select", { data: null, error: null });
      await expect(
        storage.updateDriver("ghost", { fullName: "X" }),
      ).rejects.toThrow(/driver ghost not found/);
    });

    it("listDriverAccounts filters auth users by drivers.profile_id", async () => {
      fakeClient.__enqueue("drivers", "select", {
        data: [{ profile_id: "p1" }, { profile_id: "p2" }],
        error: null,
      });
      fakeClient.auth.admin.listUsers.mockResolvedValueOnce({
        data: {
          users: [
            { id: "p1", email: "one@x.test" },
            { id: "p2", email: "two@x.test" },
            { id: "p3", email: "other@x.test" }, // not a driver
          ],
        },
        error: null,
      });
      const accounts = await storage.listDriverAccounts();
      expect(accounts).toHaveLength(2);
      expect(accounts.map((a) => a.email).sort()).toEqual([
        "one@x.test",
        "two@x.test",
      ]);
    });

    it("listDriverAccounts short-circuits to [] when no drivers exist", async () => {
      fakeClient.__enqueue("drivers", "select", { data: [], error: null });
      const accounts = await storage.listDriverAccounts();
      expect(accounts).toEqual([]);
      expect(fakeClient.auth.admin.listUsers).not.toHaveBeenCalled();
    });
  });

  // ---- Doctors --------------------------------------------------------

  describe("doctors", () => {
    it("listDoctors orders by name and maps rows", async () => {
      fakeClient.__enqueue("doctors", "select", {
        data: [
          {
            id: "d1",
            office_id: "o1",
            name: "Dr. A",
            phone: null,
            email: null,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      });
      const doctors = await storage.listDoctors();
      expect(doctors[0].name).toBe("Dr. A");
    });

    it("updateDoctor throws doctor-not-found when maybeSingle returns null", async () => {
      fakeClient.__enqueue("doctors", "update", { data: null, error: null });
      await expect(
        storage.updateDoctor("missing", { name: "X" }),
      ).rejects.toThrow(/doctor missing not found/);
    });

    it("deleteDoctor throws doctor-not-found when delete affects zero rows", async () => {
      fakeClient.__enqueue("doctors", "delete", { data: null, error: null });
      await expect(storage.deleteDoctor("missing")).rejects.toThrow(
        /doctor missing not found/,
      );
    });

    it("deleteDoctor succeeds when delete returns the id", async () => {
      fakeClient.__enqueue("doctors", "delete", {
        data: { id: "d1" },
        error: null,
      });
      await expect(storage.deleteDoctor("d1")).resolves.toBeUndefined();
    });
  });

  // ---- Pickup requests -----------------------------------------------

  describe("pickup requests", () => {
    it("listPickupRequests applies status filter when provided", async () => {
      fakeClient.__enqueue("pickup_requests", "select", {
        data: [],
        error: null,
      });
      await storage.listPickupRequests({ status: "pending" });
      const calls = fakeClient.__calls();
      expect(
        calls.some(
          (c) => c.method === "eq" && c.args[0] === "status" && c.args[1] === "pending",
        ),
      ).toBe(true);
    });

    it("getPickupRequest returns null on miss", async () => {
      fakeClient.__enqueue("pickup_requests", "select", {
        data: null,
        error: null,
      });
      expect(await storage.getPickupRequest("missing")).toBeNull();
    });

    it("updatePickupRequestStatus preserves existing flaggedReason when status='flagged' and reason undefined", async () => {
      fakeClient.__enqueue("pickup_requests", "select", {
        data: {
          id: "pr1",
          office_id: "o1",
          channel: "sms",
          source_identifier: null,
          raw_message: null,
          urgency: "routine",
          sample_count: null,
          special_instructions: null,
          status: "flagged",
          flagged_reason: "prev-reason",
          created_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-04-01T00:00:00Z",
        },
        error: null,
      });
      fakeClient.__enqueue("pickup_requests", "update", {
        data: {
          id: "pr1",
          office_id: "o1",
          channel: "sms",
          source_identifier: null,
          raw_message: null,
          urgency: "routine",
          sample_count: null,
          special_instructions: null,
          status: "flagged",
          flagged_reason: "prev-reason",
          created_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-04-22T10:00:00Z",
        },
        error: null,
      });
      const pr = await storage.updatePickupRequestStatus("pr1", "flagged");
      expect(pr.flaggedReason).toBe("prev-reason");
    });

    it("updatePickupRequestStatus clears flaggedReason when status transitions away", async () => {
      fakeClient.__enqueue("pickup_requests", "update", {
        data: {
          id: "pr1",
          office_id: "o1",
          channel: "sms",
          source_identifier: null,
          raw_message: null,
          urgency: "routine",
          sample_count: null,
          special_instructions: null,
          status: "pending",
          flagged_reason: null,
          created_at: "2026-04-01T00:00:00Z",
          updated_at: "2026-04-22T10:00:00Z",
        },
        error: null,
      });
      const pr = await storage.updatePickupRequestStatus("pr1", "pending");
      expect(pr.flaggedReason).toBeUndefined();
    });

    it("updatePickupRequestStatus throws when target row doesn't exist", async () => {
      fakeClient.__enqueue("pickup_requests", "update", {
        data: null,
        error: null,
      });
      await expect(
        storage.updatePickupRequestStatus("missing", "pending"),
      ).rejects.toThrow(/pickup request missing not found/);
    });
  });

  // ---- Routes --------------------------------------------------------

  describe("routes", () => {
    it("listRoutes applies date + driverId + status filters", async () => {
      fakeClient.__enqueue("routes", "select", { data: [], error: null });
      await storage.listRoutes({
        date: "2026-04-22",
        driverId: "p1",
        status: "active",
      });
      const eqArgs = fakeClient
        .__calls()
        .filter((c) => c.method === "eq")
        .map((c) => c.args[0]);
      expect(eqArgs).toEqual(
        expect.arrayContaining(["route_date", "driver_id", "status"]),
      );
    });

    it("updateRouteStatus throws when route does not exist", async () => {
      fakeClient.__enqueue("routes", "select", { data: null, error: null });
      await expect(
        storage.updateRouteStatus("missing", "active"),
      ).rejects.toThrow(/route missing not found/);
    });

    it("updateRouteStatus sets started_at when transitioning to active", async () => {
      fakeClient.__enqueue("routes", "select", {
        data: {
          id: "r1",
          driver_id: "p1",
          route_date: "2026-04-22",
          status: "pending",
          started_at: null,
          completed_at: null,
          created_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      fakeClient.__enqueue("routes", "update", {
        data: {
          id: "r1",
          driver_id: "p1",
          route_date: "2026-04-22",
          status: "active",
          started_at: "2026-04-22T10:00:00Z",
          completed_at: null,
          created_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      const route = await storage.updateRouteStatus("r1", "active");
      expect(route.status).toBe("active");
      expect(route.startedAt).toBe("2026-04-22T10:00:00Z");
    });
  });

  // ---- Stops ---------------------------------------------------------

  describe("stops", () => {
    it("assignRequestToRoute throws route-not-found when route missing", async () => {
      fakeClient.__enqueue("routes", "select", { data: null, error: null });
      await expect(
        storage.assignRequestToRoute("missing", "pr1"),
      ).rejects.toThrow(/route missing not found/);
    });

    it("assignRequestToRoute throws 'pickup request already assigned' when stop exists for the request", async () => {
      fakeClient.__enqueue("routes", "select", {
        data: {
          id: "r1",
          driver_id: "p1",
          route_date: "2099-12-31",
          status: "pending",
          started_at: null,
          completed_at: null,
          created_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      fakeClient.__enqueue("pickup_requests", "select", {
        data: {
          id: "pr1",
          office_id: "o1",
          channel: "web",
          source_identifier: null,
          raw_message: null,
          urgency: "routine",
          sample_count: null,
          special_instructions: null,
          status: "pending",
          flagged_reason: null,
          created_at: "2026-04-22T09:00:00Z",
          updated_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      fakeClient.__enqueue("stops", "select", {
        data: { id: "already-there" },
        error: null,
      });
      await expect(
        storage.assignRequestToRoute("r1", "pr1"),
      ).rejects.toThrow(/already assigned/);
    });

    it("assignRequestToRoute happy path appends at next position", async () => {
      fakeClient.__enqueue("routes", "select", {
        data: {
          id: "r1",
          driver_id: "p1",
          route_date: "2099-12-31",
          status: "pending",
          started_at: null,
          completed_at: null,
          created_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      fakeClient.__enqueue("pickup_requests", "select", {
        data: {
          id: "pr1",
          office_id: "o1",
          channel: "web",
          source_identifier: null,
          raw_message: null,
          urgency: "routine",
          sample_count: null,
          special_instructions: null,
          status: "pending",
          flagged_reason: null,
          created_at: "2026-04-22T09:00:00Z",
          updated_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      fakeClient.__enqueue("stops", "select", { data: null, error: null }); // existing-for-request
      fakeClient.__enqueue("stops", "select", {
        data: { position: 2 },
        error: null,
      });
      fakeClient.__enqueue("stops", "insert", {
        data: {
          id: "s1",
          route_id: "r1",
          pickup_request_id: "pr1",
          position: 3,
          eta_at: null,
          arrived_at: null,
          picked_up_at: null,
          notified_10min: false,
          created_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      fakeClient.__enqueue("pickup_requests", "update", {
        data: null,
        error: null,
      });
      const stop = await storage.assignRequestToRoute("r1", "pr1");
      expect(stop.position).toBe(3);
      expect(stop.pickupRequestId).toBe("pr1");
    });

    it("markStopArrived throws when stop already arrived", async () => {
      fakeClient.__enqueue("stops", "select", {
        data: {
          id: "s1",
          route_id: "r1",
          pickup_request_id: "pr1",
          position: 1,
          eta_at: null,
          arrived_at: "2026-04-22T10:00:00Z",
          picked_up_at: null,
          notified_10min: false,
          created_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      await expect(storage.markStopArrived("s1")).rejects.toThrow(
        /already arrived/,
      );
    });

    it("markStopPickedUp enforces arrived→pickedUp ordering", async () => {
      fakeClient.__enqueue("stops", "select", {
        data: {
          id: "s1",
          route_id: "r1",
          pickup_request_id: "pr1",
          position: 1,
          eta_at: null,
          arrived_at: null,
          picked_up_at: null,
          notified_10min: false,
          created_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      await expect(storage.markStopPickedUp("s1")).rejects.toThrow(
        /not yet arrived/,
      );
    });

    it("markStopNotified10min is idempotent when flag already true", async () => {
      fakeClient.__enqueue("stops", "select", {
        data: {
          id: "s1",
          route_id: "r1",
          pickup_request_id: "pr1",
          position: 1,
          eta_at: null,
          arrived_at: null,
          picked_up_at: null,
          notified_10min: true,
          created_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      const stop = await storage.markStopNotified10min("s1");
      expect(stop.notified10min).toBe(true);
      // No update call — idempotent short-circuit.
      expect(
        fakeClient.__calls().some((c) => c.method === "update"),
      ).toBe(false);
    });

    it("updateStopEta throws when stop not found", async () => {
      fakeClient.__enqueue("stops", "update", { data: null, error: null });
      await expect(
        storage.updateStopEta("missing", "2026-04-22T12:00:00Z"),
      ).rejects.toThrow(/stop missing not found/);
    });
  });

  // ---- Driver locations ----------------------------------------------

  describe("driver locations", () => {
    it("recordDriverLocation inserts and returns stringified id", async () => {
      fakeClient.__enqueue("driver_locations", "insert", {
        data: {
          id: 99,
          driver_id: "p1",
          route_id: null,
          lat: 1,
          lng: 2,
          recorded_at: "2026-04-22T10:00:00Z",
        },
        error: null,
      });
      const loc = await storage.recordDriverLocation({
        driverId: "p1",
        lat: 1,
        lng: 2,
      });
      expect(loc.id).toBe("99");
      expect(typeof loc.id).toBe("string");
    });

    it("listDriverLocations dedupes to latest per driver", async () => {
      fakeClient.__enqueue("driver_locations", "select", {
        data: [
          {
            id: 2,
            driver_id: "p1",
            route_id: null,
            lat: 0,
            lng: 0,
            recorded_at: "2026-04-22T10:02:00Z",
          },
          {
            id: 1,
            driver_id: "p1",
            route_id: null,
            lat: 0,
            lng: 0,
            recorded_at: "2026-04-22T10:01:00Z",
          },
          {
            id: 3,
            driver_id: "p2",
            route_id: null,
            lat: 0,
            lng: 0,
            recorded_at: "2026-04-22T10:03:00Z",
          },
        ],
        error: null,
      });
      const locs = await storage.listDriverLocations();
      expect(locs).toHaveLength(2);
      const p1 = locs.find((l) => l.driverId === "p1");
      expect(p1?.id).toBe("2");
    });
  });

  // ---- Messages ------------------------------------------------------

  describe("messages", () => {
    it("listMessages({ flagged: true }) applies the or() filter", async () => {
      fakeClient.__enqueue("messages", "select", { data: [], error: null });
      await storage.listMessages({ flagged: true });
      expect(
        fakeClient.__calls().some((c) => c.method === "or"),
      ).toBe(true);
    });

    it("createMessage round-trips and returns the domain row", async () => {
      fakeClient.__enqueue("messages", "insert", {
        data: {
          id: "m1",
          channel: "sms",
          from_identifier: "+15550001111",
          subject: null,
          body: "hi",
          received_at: "2026-04-22T10:00:00Z",
          pickup_request_id: null,
        },
        error: null,
      });
      const msg = await storage.createMessage({
        channel: "sms",
        fromIdentifier: "+15550001111",
        body: "hi",
      });
      expect(msg.id).toBe("m1");
    });

    it("linkMessageToRequest throws when message already linked to a different request", async () => {
      fakeClient.__enqueue("messages", "select", {
        data: {
          id: "m1",
          channel: "sms",
          from_identifier: "+15550001111",
          subject: null,
          body: "hi",
          received_at: "2026-04-22T10:00:00Z",
          pickup_request_id: "pr-other",
        },
        error: null,
      });
      await expect(
        storage.linkMessageToRequest("m1", "pr-new"),
      ).rejects.toThrow(/message already linked/);
    });

    it("linkMessageToRequest is idempotent when target matches", async () => {
      fakeClient.__enqueue("messages", "select", {
        data: {
          id: "m1",
          channel: "sms",
          from_identifier: "+15550001111",
          subject: null,
          body: "hi",
          received_at: "2026-04-22T10:00:00Z",
          pickup_request_id: "pr-same",
        },
        error: null,
      });
      fakeClient.__enqueue("messages", "update", {
        data: {
          id: "m1",
          channel: "sms",
          from_identifier: "+15550001111",
          subject: null,
          body: "hi",
          received_at: "2026-04-22T10:00:00Z",
          pickup_request_id: "pr-same",
        },
        error: null,
      });
      const msg = await storage.linkMessageToRequest("m1", "pr-same");
      expect(msg.pickupRequestId).toBe("pr-same");
    });

    it("createRequestFromMessage throws when message already linked", async () => {
      fakeClient.__enqueue("messages", "select", {
        data: {
          id: "m1",
          channel: "sms",
          from_identifier: "+1",
          subject: null,
          body: "x",
          received_at: "2026-04-22T10:00:00Z",
          pickup_request_id: "pr-existing",
        },
        error: null,
      });
      await expect(storage.createRequestFromMessage("m1")).rejects.toThrow(
        /already linked/,
      );
    });

    it("createRequestFromMessage inserts a new pickup request and links the message", async () => {
      fakeClient.__enqueue("messages", "select", {
        data: {
          id: "m1",
          channel: "sms",
          from_identifier: "+15550001111",
          subject: null,
          body: "2 samples",
          received_at: "2026-04-22T10:00:00Z",
          pickup_request_id: null,
        },
        error: null,
      });
      fakeClient.__enqueue("pickup_requests", "insert", {
        data: {
          id: "pr-new",
          office_id: null,
          channel: "sms",
          source_identifier: "+15550001111",
          raw_message: "2 samples",
          urgency: "routine",
          sample_count: null,
          special_instructions: null,
          status: "pending",
          flagged_reason: null,
          created_at: "2026-04-22T10:00:00Z",
          updated_at: "2026-04-22T10:00:00Z",
        },
        error: null,
      });
      fakeClient.__enqueue("messages", "update", { data: null, error: null });
      const pr = await storage.createRequestFromMessage("m1");
      expect(pr.id).toBe("pr-new");
      expect(pr.sourceIdentifier).toBe("+15550001111");
    });
  });

  // ---- Dashboards ----------------------------------------------------

  describe("dashboard counts", () => {
    it("countAdminDashboard reads counts from head=true responses", async () => {
      fakeClient.__enqueue("drivers", "select", {
        data: null,
        error: null,
        count: 4,
      });
      fakeClient.__enqueue("doctors", "select", {
        data: null,
        error: null,
        count: 10,
      });
      fakeClient.__enqueue("offices", "select", {
        data: null,
        error: null,
        count: 6,
      });
      fakeClient.__enqueue("pickup_requests", "select", {
        data: null,
        error: null,
        count: 2,
      });
      const counts = await storage.countAdminDashboard();
      expect(counts).toEqual({
        drivers: 4,
        doctors: 10,
        offices: 6,
        pendingPickupRequests: 2,
      });
    });

    it("countDispatcherDashboard aggregates pending/active/stops/flagged", async () => {
      fakeClient.__enqueue("pickup_requests", "select", {
        data: null,
        error: null,
        count: 5,
      });
      fakeClient.__enqueue("routes", "select", {
        data: null,
        error: null,
        count: 2,
      });
      fakeClient.__enqueue("routes", "select", {
        data: [{ id: "r1" }, { id: "r2" }],
        error: null,
      });
      fakeClient.__enqueue("messages", "select", {
        data: null,
        error: null,
        count: 3,
      });
      fakeClient.__enqueue("stops", "select", {
        data: null,
        error: null,
        count: 7,
      });
      const counts = await storage.countDispatcherDashboard("2026-04-22");
      expect(counts).toEqual({
        pendingRequests: 5,
        todayStops: 7,
        activeRoutes: 2,
        flaggedMessages: 3,
      });
    });

    it("countDispatcherDashboard handles no routes for the date (todayStops=0)", async () => {
      fakeClient.__enqueue("pickup_requests", "select", {
        data: null,
        error: null,
        count: 5,
      });
      fakeClient.__enqueue("routes", "select", {
        data: null,
        error: null,
        count: 2,
      });
      fakeClient.__enqueue("routes", "select", { data: [], error: null });
      fakeClient.__enqueue("messages", "select", {
        data: null,
        error: null,
        count: 3,
      });
      const counts = await storage.countDispatcherDashboard("2026-04-22");
      expect(counts.todayStops).toBe(0);
    });
  });

  // ---- reorderStops + removeStopFromRoute ----------------------------

  describe("stops reordering + removal", () => {
    it("reorderStops throws route-not-found when route missing", async () => {
      fakeClient.__enqueue("routes", "select", { data: null, error: null });
      await expect(storage.reorderStops("missing", [])).rejects.toThrow(
        /route missing not found/,
      );
    });

    it("reorderStops happy path updates positions 1..N", async () => {
      fakeClient.__enqueue("routes", "select", {
        data: {
          id: "r1",
          driver_id: "p1",
          route_date: "2099-12-31",
          status: "pending",
          started_at: null,
          completed_at: null,
          created_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      fakeClient.__enqueue("stops", "select", {
        data: [
          {
            id: "s1",
            route_id: "r1",
            pickup_request_id: "pr1",
            position: 1,
            eta_at: null,
            arrived_at: null,
            picked_up_at: null,
            notified_10min: false,
            created_at: "2026-04-22T09:00:00Z",
          },
          {
            id: "s2",
            route_id: "r1",
            pickup_request_id: "pr2",
            position: 2,
            eta_at: null,
            arrived_at: null,
            picked_up_at: null,
            notified_10min: false,
            created_at: "2026-04-22T09:00:00Z",
          },
        ],
        error: null,
      });
      // Two updates (one per stop).
      fakeClient.__enqueue("stops", "update", { data: null, error: null });
      fakeClient.__enqueue("stops", "update", { data: null, error: null });
      await expect(
        storage.reorderStops("r1", ["s2", "s1"]),
      ).resolves.toBeUndefined();
      const updates = fakeClient
        .__calls()
        .filter((c) => c.method === "update");
      expect(updates).toHaveLength(2);
    });

    it("removeStopFromRoute deletes, renumbers survivors, flips PR to pending", async () => {
      fakeClient.__enqueue("stops", "select", {
        data: {
          id: "s2",
          route_id: "r1",
          pickup_request_id: "pr2",
          position: 2,
          eta_at: null,
          arrived_at: null,
          picked_up_at: null,
          notified_10min: false,
          created_at: "2026-04-22T09:00:00Z",
        },
        error: null,
      });
      fakeClient.__enqueue("stops", "delete", { data: null, error: null });
      fakeClient.__enqueue("stops", "select", {
        data: [
          {
            id: "s1",
            route_id: "r1",
            pickup_request_id: "pr1",
            position: 1,
            eta_at: null,
            arrived_at: null,
            picked_up_at: null,
            notified_10min: false,
            created_at: "2026-04-22T09:00:00Z",
          },
          {
            id: "s3",
            route_id: "r1",
            pickup_request_id: "pr3",
            position: 3,
            eta_at: null,
            arrived_at: null,
            picked_up_at: null,
            notified_10min: false,
            created_at: "2026-04-22T09:00:00Z",
          },
        ],
        error: null,
      });
      // s1 position stays 1 (no-op skip); s3 updates to position 2.
      fakeClient.__enqueue("stops", "update", { data: null, error: null });
      fakeClient.__enqueue("pickup_requests", "update", {
        data: null,
        error: null,
      });
      await expect(
        storage.removeStopFromRoute("s2"),
      ).resolves.toBeUndefined();
    });
  });
});
