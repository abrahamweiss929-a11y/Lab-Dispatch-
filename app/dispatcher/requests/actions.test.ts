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
  assignRequestToRouteAction,
  createManualRequestAction,
  flagRequestAction,
  markResolvedAction,
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

async function seedDriver(fullName = "Alice Driver") {
  return storageMock.createDriver({
    email: `${fullName.toLowerCase().replace(/\s+/g, ".")}@test`,
    fullName,
    active: true,
  });
}

describe("dispatcher/requests server actions", () => {
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

  describe("assignRequestToRouteAction", () => {
    it("links a request to a route and flips its status to assigned", async () => {
      const office = await seedOffice();
      const driver = await seedDriver();
      const route = await storageMock.createRoute({
        driverId: driver.profileId,
        routeDate: "2026-04-22",
      });
      const req = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });

      await assignRequestToRouteAction(req.id, fd({ routeId: route.id }));

      const after = await storageMock.listPickupRequests();
      expect(after[0]?.status).toBe("assigned");
      const stops = await storageMock.listStops(route.id);
      expect(stops).toHaveLength(1);
      expect(stops[0]?.pickupRequestId).toBe(req.id);
      expect(revalidatePathMock).toHaveBeenCalledWith("/dispatcher/requests");
      expect(revalidatePathMock).toHaveBeenCalledWith(
        `/dispatcher/routes/${route.id}`,
      );
    });

    it("bails out on auth failure before touching storage", async () => {
      const office = await seedOffice();
      const req = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "assignRequestToRoute");
      await expect(
        assignRequestToRouteAction(req.id, fd({ routeId: "anything" })),
      ).rejects.toThrow(/REDIRECT:\/login/);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("flagRequestAction", () => {
    it("flags a request and stores the reason", async () => {
      const office = await seedOffice();
      const req = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });

      await flagRequestAction(req.id, fd({ reason: "Missing address" }));

      const after = await storageMock.listPickupRequests();
      expect(after[0]?.status).toBe("flagged");
      expect(after[0]?.flaggedReason).toBe("Missing address");
      expect(revalidatePathMock).toHaveBeenCalledWith("/dispatcher/requests");
    });

    it("is a no-op when the reason is empty", async () => {
      const office = await seedOffice();
      const req = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });
      const spy = vi.spyOn(storageMock, "updatePickupRequestStatus");
      await flagRequestAction(req.id, fd({ reason: "   " }));
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("bails out on auth failure", async () => {
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "updatePickupRequestStatus");
      await expect(
        flagRequestAction("req", fd({ reason: "x" })),
      ).rejects.toThrow(/REDIRECT:\/login/);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("markResolvedAction", () => {
    it("sets status to completed", async () => {
      const office = await seedOffice();
      const req = await storageMock.createPickupRequest({
        officeId: office.id,
        channel: "manual",
        urgency: "routine",
      });

      await markResolvedAction(req.id);

      const after = await storageMock.listPickupRequests();
      expect(after[0]?.status).toBe("completed");
      expect(revalidatePathMock).toHaveBeenCalledWith("/dispatcher/requests");
    });

    it("bails out on auth failure", async () => {
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "updatePickupRequestStatus");
      await expect(markResolvedAction("req")).rejects.toThrow(
        /REDIRECT:\/login/,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("createManualRequestAction", () => {
    it("creates a pending manual request", async () => {
      const office = await seedOffice();
      await expect(
        createManualRequestAction(
          INITIAL_ADMIN_FORM_STATE,
          fd({
            officeId: office.id,
            urgency: "urgent",
            sampleCount: "3",
            specialInstructions: "Back door",
          }),
        ),
      ).rejects.toThrow(/REDIRECT:\/dispatcher\/requests/);

      const rows = await storageMock.listPickupRequests();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.channel).toBe("manual");
      expect(rows[0]?.status).toBe("pending");
      expect(rows[0]?.urgency).toBe("urgent");
      expect(rows[0]?.sampleCount).toBe(3);
      expect(rows[0]?.specialInstructions).toBe("Back door");
    });

    it("rejects an unknown officeId", async () => {
      await seedOffice();
      const state = await createManualRequestAction(
        INITIAL_ADMIN_FORM_STATE,
        fd({ officeId: "missing", urgency: "routine" }),
      );
      expect(state.fieldErrors.officeId).toBe("Office not found");
      expect(await storageMock.listPickupRequests()).toHaveLength(0);
    });

    it("requires an officeId", async () => {
      const state = await createManualRequestAction(
        INITIAL_ADMIN_FORM_STATE,
        fd({ officeId: "", urgency: "routine" }),
      );
      expect(state.fieldErrors.officeId).toBeTruthy();
    });

    it("bails out on auth failure before touching storage", async () => {
      const office = await seedOffice();
      requireDispatcherSessionMock.mockImplementationOnce(() => {
        throw new Error("REDIRECT:/login");
      });
      const spy = vi.spyOn(storageMock, "createPickupRequest");
      await expect(
        createManualRequestAction(
          INITIAL_ADMIN_FORM_STATE,
          fd({ officeId: office.id, urgency: "routine" }),
        ),
      ).rejects.toThrow(/REDIRECT:\/login/);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
