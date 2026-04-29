import { describe, expect, it, vi, beforeEach } from "vitest";

const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
const requireDispatcherSessionMock = vi.fn(() => ({
  userId: "dispatcher-test",
  role: "dispatcher" as const,
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

vi.mock("@/lib/require-dispatcher", () => ({
  requireDispatcherSession: () => requireDispatcherSessionMock(),
}));

import {
  addStopToRouteAction,
  completeRouteAction,
  createRouteAction,
  moveStopDownAction,
  moveStopUpAction,
  optimizeRouteAction,
  removeStopAction,
  resetRouteAction,
  startRouteAction,
} from "./actions";
import { INITIAL_ADMIN_FORM_STATE } from "@/lib/admin-form";
import { __resetGoogleMapsCache } from "@/lib/google-maps";
import { storageMock, resetStorageMock } from "@/mocks/storage";

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    form.set(key, value);
  }
  return form;
}

const ADDRESS = {
  street: "100 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

async function seedOffice(name = "Acme Clinic") {
  return storageMock.createOffice({
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    pickupUrlToken: "tok-" + name.toLowerCase().replace(/\s+/g, "-"),
    address: ADDRESS,
    active: true,
  });
}

async function seedActiveDriver(fullName = "Alice Driver") {
  return storageMock.createDriver({
    email: `${fullName.toLowerCase().replace(/\s+/g, ".")}@test`,
    fullName,
    active: true,
  });
}

describe("dispatcher/routes server actions", () => {
  beforeEach(() => {
    resetStorageMock();
    revalidatePathMock.mockClear();
    redirectMock.mockClear();
    requireDispatcherSessionMock.mockReset();
    requireDispatcherSessionMock.mockReturnValue({
      userId: "dispatcher-test",
      role: "dispatcher",
    });
  });

  describe("createRouteAction", () => {
    it("creates a route and redirects to its detail page", async () => {
      const driver = await seedActiveDriver();
      await expect(
        createRouteAction(
          INITIAL_ADMIN_FORM_STATE,
          fd({ driverId: driver.profileId, routeDate: "2099-12-31" }),
        ),
      ).rejects.toThrow(/REDIRECT:\/dispatcher\/routes\//);
      const routes = await storageMock.listRoutes({});
      expect(routes).toHaveLength(1);
      expect(routes[0]?.status).toBe("pending");
      expect(routes[0]?.routeDate).toBe("2099-12-31");
    });

    it("rejects missing driverId", async () => {
      const state = await createRouteAction(
        INITIAL_ADMIN_FORM_STATE,
        fd({ driverId: "", routeDate: "2099-12-31" }),
      );
      expect(state.fieldErrors.driverId).toBeTruthy();
    });

    it("rejects malformed date", async () => {
      const driver = await seedActiveDriver();
      const state = await createRouteAction(
        INITIAL_ADMIN_FORM_STATE,
        fd({ driverId: driver.profileId, routeDate: "not-a-date" }),
      );
      expect(state.fieldErrors.routeDate).toBeTruthy();
    });

    it("rejects inactive driver", async () => {
      const driver = await seedActiveDriver();
      await storageMock.updateDriver(driver.profileId, { active: false });
      const state = await createRouteAction(
        INITIAL_ADMIN_FORM_STATE,
        fd({ driverId: driver.profileId, routeDate: "2099-12-31" }),
      );
      expect(state.fieldErrors.driverId).toBe("Driver is inactive");
    });

    it("bails out on auth failure", async () => {
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "createRoute");
      await expect(
        createRouteAction(
          INITIAL_ADMIN_FORM_STATE,
          fd({ driverId: "x", routeDate: "2099-12-31" }),
        ),
      ).rejects.toThrow(/REDIRECT:\/login/);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("attaches selected pending requestIds as stops in submission order", async () => {
      const driver = await seedActiveDriver();
      const office = await seedOffice();
      const r1 = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });
      const r2 = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "urgent",
      });
      const r3 = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });

      // Build a FormData with multiple `requestIds` entries (the
      // standard checkbox-array pattern).
      const form = new FormData();
      form.set("driverId", driver.profileId);
      form.set("routeDate", "2099-12-31");
      form.append("requestIds", r1.id);
      form.append("requestIds", r2.id);
      form.append("requestIds", r3.id);

      await expect(
        createRouteAction(INITIAL_ADMIN_FORM_STATE, form),
      ).rejects.toThrow(/REDIRECT:\/dispatcher\/routes\//);

      const routes = await storageMock.listRoutes({});
      expect(routes).toHaveLength(1);
      const stops = await storageMock.listStops(routes[0]!.id);
      expect(stops).toHaveLength(3);
      // Order matches form submission order.
      expect(stops.map((s) => s.pickupRequestId)).toEqual([r1.id, r2.id, r3.id]);
      expect(stops.map((s) => s.position)).toEqual([1, 2, 3]);
    });

    it("creates a route with NO stops when no requestIds are submitted", async () => {
      const driver = await seedActiveDriver();
      await expect(
        createRouteAction(
          INITIAL_ADMIN_FORM_STATE,
          fd({ driverId: driver.profileId, routeDate: "2099-12-31" }),
        ),
      ).rejects.toThrow(/REDIRECT:\/dispatcher\/routes\//);
      const routes = await storageMock.listRoutes({});
      const stops = await storageMock.listStops(routes[0]!.id);
      expect(stops).toHaveLength(0);
    });
  });

  describe("addStopToRouteAction", () => {
    it("appends a stop at the next position", async () => {
      const office = await seedOffice();
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2099-12-31",
      });
      const req = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });

      await addStopToRouteAction(route.id, fd({ pickupRequestId: req.id }));

      const stops = await storageMock.listStops(route.id);
      expect(stops).toHaveLength(1);
      expect(stops[0]?.position).toBe(1);
      expect(stops[0]?.pickupRequestId).toBe(req.id);
    });

    it("populates etaAt when the preceding stop and both offices have coords", async () => {
      const officeA = await storageMock.createOffice({
        name: "Alpha",
        slug: "alpha",
        pickupUrlToken: "tok-alpha",
        address: ADDRESS,
        active: true,
        lat: 40.0,
        lng: -74.0,
      });
      const officeB = await storageMock.createOffice({
        name: "Bravo",
        slug: "bravo",
        pickupUrlToken: "tok-bravo",
        address: ADDRESS,
        active: true,
        lat: 40.5,
        lng: -74.5,
      });
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2099-12-31",
      });
      const reqA = await storageMock.createPickupRequest({
        officeId: officeA.id,
        channel: "manual",
        urgency: "routine",
      });
      await storageMock.assignRequestToRoute(route.id, reqA.id);
      const reqB = await storageMock.createPickupRequest({
        officeId: officeB.id,
        channel: "manual",
        urgency: "routine",
      });

      await addStopToRouteAction(route.id, fd({ pickupRequestId: reqB.id }));

      const stops = await storageMock.listStops(route.id);
      expect(stops).toHaveLength(2);
      expect(stops[1]?.etaAt).toBeTruthy();
    });

    it("leaves etaAt undefined at position 1", async () => {
      const office = await seedOffice();
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2099-12-31",
      });
      const req = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });

      await addStopToRouteAction(route.id, fd({ pickupRequestId: req.id }));

      const stops = await storageMock.listStops(route.id);
      expect(stops[0]?.etaAt).toBeUndefined();
    });

    it("leaves etaAt undefined when target office lacks coords", async () => {
      const officeA = await storageMock.createOffice({
        name: "Alpha",
        slug: "alpha",
        pickupUrlToken: "tok-alpha",
        address: ADDRESS,
        active: true,
        lat: 40.0,
        lng: -74.0,
      });
      const officeB = await storageMock.createOffice({
        name: "Bravo",
        slug: "bravo",
        pickupUrlToken: "tok-bravo",
        address: ADDRESS,
        active: true,
      });
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2099-12-31",
      });
      const reqA = await storageMock.createPickupRequest({
        officeId: officeA.id,
        channel: "manual",
        urgency: "routine",
      });
      await storageMock.assignRequestToRoute(route.id, reqA.id);
      const reqB = await storageMock.createPickupRequest({
        officeId: officeB.id,
        channel: "manual",
        urgency: "routine",
      });

      await addStopToRouteAction(route.id, fd({ pickupRequestId: reqB.id }));

      const stops = await storageMock.listStops(route.id);
      expect(stops[1]?.etaAt).toBeUndefined();
    });

    it("throws when editing a route dated in the past", async () => {
      const office = await seedOffice();
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "1970-01-01",
      });
      const req = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });
      const spy = vi.spyOn(storageMock, "assignRequestToRoute");

      await expect(
        addStopToRouteAction(route.id, fd({ pickupRequestId: req.id })),
      ).rejects.toThrow(/cannot edit past route/);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("surfaces the storage error when the request is already assigned", async () => {
      const office = await seedOffice();
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2099-12-31",
      });
      const req = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });
      await storageMock.assignRequestToRoute(route.id, req.id);

      await expect(
        addStopToRouteAction(route.id, fd({ pickupRequestId: req.id })),
      ).rejects.toThrow(/already assigned/);
    });

    it("bails out on auth failure", async () => {
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "assignRequestToRoute");
      await expect(
        addStopToRouteAction("route", fd({ pickupRequestId: "req" })),
      ).rejects.toThrow(/REDIRECT:\/login/);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("removeStopAction", () => {
    it("removes the stop and returns the pickup request to pending", async () => {
      const office = await seedOffice();
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2099-12-31",
      });
      const req = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });
      const stop = await storageMock.assignRequestToRoute(route.id, req.id);

      await removeStopAction(route.id, stop.id);

      const stops = await storageMock.listStops(route.id);
      expect(stops).toHaveLength(0);
      const requests = await storageMock.listPickupRequests();
      expect(requests[0]?.status).toBe("pending");
    });

    it("bails out on auth failure", async () => {
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "removeStopFromRoute");
      await expect(removeStopAction("r", "s")).rejects.toThrow(
        /REDIRECT:\/login/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("throws when the route is dated in the past", async () => {
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "1970-01-01",
      });
      const spy = vi.spyOn(storageMock, "removeStopFromRoute");
      await expect(removeStopAction(route.id, "s")).rejects.toThrow(
        /cannot edit past route/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("moveStopUpAction / moveStopDownAction", () => {
    async function seedThreeStops() {
      const office = await seedOffice();
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2099-12-31",
      });
      const r1 = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });
      const r2 = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });
      const r3 = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });
      const s1 = await storageMock.assignRequestToRoute(route.id, r1.id);
      const s2 = await storageMock.assignRequestToRoute(route.id, r2.id);
      const s3 = await storageMock.assignRequestToRoute(route.id, r3.id);
      return { route, stops: [s1, s2, s3] };
    }

    it("swaps a middle stop upward", async () => {
      const { route, stops } = await seedThreeStops();
      await moveStopUpAction(route.id, stops[1].id);
      const after = await storageMock.listStops(route.id);
      expect(after.map((s) => s.id)).toEqual([
        stops[1].id,
        stops[0].id,
        stops[2].id,
      ]);
    });

    it("is a no-op when the head stop tries to move up", async () => {
      const { route, stops } = await seedThreeStops();
      await moveStopUpAction(route.id, stops[0].id);
      const after = await storageMock.listStops(route.id);
      expect(after.map((s) => s.id)).toEqual([
        stops[0].id,
        stops[1].id,
        stops[2].id,
      ]);
    });

    it("swaps a middle stop downward", async () => {
      const { route, stops } = await seedThreeStops();
      await moveStopDownAction(route.id, stops[1].id);
      const after = await storageMock.listStops(route.id);
      expect(after.map((s) => s.id)).toEqual([
        stops[0].id,
        stops[2].id,
        stops[1].id,
      ]);
    });

    it("is a no-op when the tail stop tries to move down", async () => {
      const { route, stops } = await seedThreeStops();
      await moveStopDownAction(route.id, stops[2].id);
      const after = await storageMock.listStops(route.id);
      expect(after.map((s) => s.id)).toEqual([
        stops[0].id,
        stops[1].id,
        stops[2].id,
      ]);
    });

    it("moveStopUpAction bails out on auth failure", async () => {
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "reorderStops");
      await expect(moveStopUpAction("r", "s")).rejects.toThrow(
        /REDIRECT:\/login/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("moveStopDownAction bails out on auth failure", async () => {
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "reorderStops");
      await expect(moveStopDownAction("r", "s")).rejects.toThrow(
        /REDIRECT:\/login/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("moveStopUpAction throws when the route is dated in the past", async () => {
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "1970-01-01",
      });
      const spy = vi.spyOn(storageMock, "reorderStops");
      await expect(moveStopUpAction(route.id, "s")).rejects.toThrow(
        /cannot edit past route/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("moveStopDownAction throws when the route is dated in the past", async () => {
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "1970-01-01",
      });
      const spy = vi.spyOn(storageMock, "reorderStops");
      await expect(moveStopDownAction(route.id, "s")).rejects.toThrow(
        /cannot edit past route/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("route status transitions", () => {
    async function seedRouteRow() {
      const driver = await seedActiveDriver();
      return storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2099-12-31",
      });
    }

    it("startRouteAction transitions pending → active", async () => {
      const route = await seedRouteRow();
      await startRouteAction(route.id);
      const after = await storageMock.getRoute(route.id);
      expect(after?.status).toBe("active");
      expect(after?.startedAt).toBeTruthy();
    });

    it("completeRouteAction transitions active → completed", async () => {
      const route = await seedRouteRow();
      await storageMock.updateRouteStatus(route.id, "active");
      await completeRouteAction(route.id);
      const after = await storageMock.getRoute(route.id);
      expect(after?.status).toBe("completed");
      expect(after?.completedAt).toBeTruthy();
    });

    it("resetRouteAction returns a route to pending and clears timestamps", async () => {
      const route = await seedRouteRow();
      await storageMock.updateRouteStatus(route.id, "active");
      await storageMock.updateRouteStatus(route.id, "completed");
      await resetRouteAction(route.id);
      const after = await storageMock.getRoute(route.id);
      expect(after?.status).toBe("pending");
      expect(after?.startedAt).toBeUndefined();
      expect(after?.completedAt).toBeUndefined();
    });

    it("startRouteAction bails out on auth failure", async () => {
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "updateRouteStatus");
      await expect(startRouteAction("r")).rejects.toThrow(/REDIRECT:\/login/);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("completeRouteAction bails out on auth failure", async () => {
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "updateRouteStatus");
      await expect(completeRouteAction("r")).rejects.toThrow(
        /REDIRECT:\/login/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("resetRouteAction bails out on auth failure", async () => {
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "updateRouteStatus");
      await expect(resetRouteAction("r")).rejects.toThrow(/REDIRECT:\/login/);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("startRouteAction throws when the route is dated in the past", async () => {
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "1970-01-01",
      });
      const spy = vi.spyOn(storageMock, "updateRouteStatus");
      await expect(startRouteAction(route.id)).rejects.toThrow(
        /cannot edit past route/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("completeRouteAction throws when the route is dated in the past", async () => {
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "1970-01-01",
      });
      const spy = vi.spyOn(storageMock, "updateRouteStatus");
      await expect(completeRouteAction(route.id)).rejects.toThrow(
        /cannot edit past route/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("resetRouteAction throws when the route is dated in the past", async () => {
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "1970-01-01",
      });
      const spy = vi.spyOn(storageMock, "updateRouteStatus");
      await expect(resetRouteAction(route.id)).rejects.toThrow(
        /cannot edit past route/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("optimizeRouteAction", () => {
    function jsonResponse(body: unknown) {
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }

    async function seedFourGeocodedStops() {
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2099-12-31",
      });
      const offices = await Promise.all([
        storageMock.createOffice({
          name: "A",
          slug: "a",
          pickupUrlToken: "tok-a",
          address: ADDRESS,
          active: true,
          lat: 40.0,
          lng: -74.0,
        }),
        storageMock.createOffice({
          name: "B",
          slug: "b",
          pickupUrlToken: "tok-b",
          address: ADDRESS,
          active: true,
          lat: 40.1,
          lng: -74.1,
        }),
        storageMock.createOffice({
          name: "C",
          slug: "c",
          pickupUrlToken: "tok-c",
          address: ADDRESS,
          active: true,
          lat: 40.2,
          lng: -74.2,
        }),
        storageMock.createOffice({
          name: "D",
          slug: "d",
          pickupUrlToken: "tok-d",
          address: ADDRESS,
          active: true,
          lat: 40.3,
          lng: -74.3,
        }),
      ]);
      const stops = [];
      for (const office of offices) {
        const req = await storageMock.createPickupRequest({
          officeId: office.id,
          channel: "manual",
          urgency: "routine",
        });
        stops.push(await storageMock.assignRequestToRoute(route.id, req.id));
      }
      return { route, stops };
    }

    beforeEach(() => {
      __resetGoogleMapsCache();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      process.env.GOOGLE_MAPS_API_KEY = "test-key";
    });

    it("returns not_enough_stops when fewer than 3 remain", async () => {
      const office = await seedOffice();
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2099-12-31",
      });
      const req = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });
      await storageMock.assignRequestToRoute(route.id, req.id);

      const result = await optimizeRouteAction(route.id);
      expect(result.status).toBe("not_enough_stops");
    });

    it("returns missing_coordinates when an office lacks lat/lng", async () => {
      const driver = await seedActiveDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2099-12-31",
      });
      // Three offices, second is missing coords.
      const o1 = await storageMock.createOffice({
        name: "A",
        slug: "a",
        pickupUrlToken: "ta",
        address: ADDRESS,
        active: true,
        lat: 40.0,
        lng: -74.0,
      });
      const o2 = await storageMock.createOffice({
        name: "B",
        slug: "b",
        pickupUrlToken: "tb",
        address: ADDRESS,
        active: true,
      });
      const o3 = await storageMock.createOffice({
        name: "C",
        slug: "c",
        pickupUrlToken: "tc",
        address: ADDRESS,
        active: true,
        lat: 40.2,
        lng: -74.2,
      });
      for (const o of [o1, o2, o3]) {
        const r = await storageMock.createPickupRequest({
          officeId: o.id,
          channel: "manual",
          urgency: "routine",
        });
        await storageMock.assignRequestToRoute(route.id, r.id);
      }

      const result = await optimizeRouteAction(route.id);
      expect(result.status).toBe("missing_coordinates");
    });

    it("returns unavailable when Google API has no key", async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      const { route } = await seedFourGeocodedStops();
      const result = await optimizeRouteAction(route.id);
      expect(result.status).toBe("unavailable");
    });

    it("returns already_optimal and does not reorder when permutation is identity", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonResponse({
            status: "OK",
            routes: [
              {
                waypoint_order: [0, 1],
                legs: [
                  { duration_in_traffic: { value: 100 } },
                  { duration_in_traffic: { value: 100 } },
                  { duration_in_traffic: { value: 100 } },
                ],
              },
            ],
          }),
        ),
      );
      const { route } = await seedFourGeocodedStops();
      const before = (await storageMock.listStops(route.id)).map((s) => s.id);
      const result = await optimizeRouteAction(route.id);
      expect(result.status).toBe("already_optimal");
      const after = (await storageMock.listStops(route.id)).map((s) => s.id);
      expect(after).toEqual(before);
      vi.unstubAllGlobals();
    });

    it("reorders stops when Google returns a non-identity permutation", async () => {
      // Optimize: waypoint_order = [1, 0] swaps the two middle stops (B/C → C/B).
      // Distance Matrix calls (baseline drive times) — return 600s per leg.
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async (input: URL) => {
          const url = input.toString();
          if (url.includes("/directions/json")) {
            return jsonResponse({
              status: "OK",
              routes: [
                {
                  waypoint_order: [1, 0],
                  legs: [
                    { duration_in_traffic: { value: 100 } },
                    { duration_in_traffic: { value: 100 } },
                    { duration_in_traffic: { value: 100 } },
                  ],
                },
              ],
            });
          }
          // Distance Matrix fallback for baseline computation.
          return jsonResponse({
            status: "OK",
            rows: [
              {
                elements: [
                  { status: "OK", duration_in_traffic: { value: 600 } },
                ],
              },
            ],
          });
        }),
      );
      const { route, stops } = await seedFourGeocodedStops();
      const idsBefore = stops.map((s) => s.id);
      const result = await optimizeRouteAction(route.id);
      expect(result.status).toBe("reordered");
      const after = await storageMock.listStops(route.id);
      const afterIds = after.map((s) => s.id);
      // Origin (stops[0]) and destination (stops[3]) are pinned; middle stops
      // [1] and [2] swap.
      expect(afterIds[0]).toBe(idsBefore[0]);
      expect(afterIds[1]).toBe(idsBefore[2]);
      expect(afterIds[2]).toBe(idsBefore[1]);
      expect(afterIds[3]).toBe(idsBefore[3]);
      // Positions should be 1..4 contiguous.
      expect(after.map((s) => s.position)).toEqual([1, 2, 3, 4]);
      vi.unstubAllGlobals();
    });

    it("bails out on auth failure", async () => {
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "reorderStops");
      await expect(optimizeRouteAction("r")).rejects.toThrow(
        /REDIRECT:\/login/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
