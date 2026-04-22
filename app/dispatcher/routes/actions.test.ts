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
  removeStopAction,
  resetRouteAction,
  startRouteAction,
} from "./actions";
import { INITIAL_ADMIN_FORM_STATE } from "@/lib/admin-form";
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
});
