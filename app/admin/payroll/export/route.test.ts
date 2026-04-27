import { describe, expect, it, vi, beforeEach } from "vitest";

const getSessionMock = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});

vi.mock("@/lib/session", () => ({
  getSession: () => getSessionMock(),
  SESSION_COOKIE: "ld_session",
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

import { GET } from "./route";
import { resetStorageMock, storageMock } from "@/mocks/storage";

const ADDRESS = {
  street: "100 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

async function seedDriver(name = "Alice Driver") {
  return storageMock.createDriver({
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@test`,
    fullName: name,
    active: true,
  });
}

async function seedOffice(name: string) {
  return storageMock.createOffice({
    name,
    slug: name.toLowerCase(),
    pickupUrlToken: `tok-${name.toLowerCase()}`,
    address: ADDRESS,
    active: true,
  });
}

describe("/admin/payroll/export GET", () => {
  beforeEach(() => {
    resetStorageMock();
    getSessionMock.mockReset();
    redirectMock.mockClear();
    getSessionMock.mockResolvedValue({ userId: "u-admin", role: "admin" });
  });

  function makeRequest(qs: string): Request {
    return new Request(`http://localhost/admin/payroll/export?${qs}`);
  }

  it("redirects driver sessions to /login (only office roles allowed)", async () => {
    // Post-unification: 'dispatcher' is admin-equivalent (back-office),
    // so the driver is the only authenticated role that should be denied.
    getSessionMock.mockResolvedValue({ userId: "u", role: "driver" });
    await expect(GET(makeRequest("preset=today"))).rejects.toThrow(
      /REDIRECT:\/login/,
    );
  });

  it("allows dispatcher and office sessions (post-unification)", async () => {
    getSessionMock.mockResolvedValue({ userId: "u", role: "dispatcher" });
    const resp = await GET(makeRequest("preset=today"));
    expect(resp.status).toBe(200);

    getSessionMock.mockResolvedValue({ userId: "u", role: "office" });
    const resp2 = await GET(makeRequest("preset=today"));
    expect(resp2.status).toBe(200);
  });

  it("returns CSV with correct headers and filename", async () => {
    const resp = await GET(makeRequest("preset=custom&start=2026-04-01&end=2026-04-30"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("text/csv");
    expect(resp.headers.get("Content-Disposition")).toBe(
      'attachment; filename="payroll-2026-04-01-to-2026-04-30.csv"',
    );
  });

  it("CSV body for empty range is just header + TOTAL row", async () => {
    const resp = await GET(makeRequest("preset=today"));
    const text = await resp.text();
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Driver,Start,End,Hours Worked,Stops Done,Avg per Stop");
    expect(lines[1].startsWith("TOTAL,")).toBe(true);
  });

  it("CSV body includes a row per qualifying driver in range", async () => {
    const driver = await seedDriver();
    const office = await seedOffice("Acme");
    const route = await storageMock.createRoute({
      driverId: driver.profileId,
      routeDate: "2026-04-26",
    });
    const req = await storageMock.createPickupRequest({
      officeId: office.id,
      channel: "manual",
      urgency: "routine",
    });
    const stop = await storageMock.assignRequestToRoute(route.id, req.id);
    await storageMock.updateRouteStatus(route.id, "active");
    await storageMock.markStopArrived(stop.id);
    await storageMock.markStopPickedUp(stop.id);

    const resp = await GET(
      makeRequest("preset=custom&start=2026-04-26&end=2026-04-26"),
    );
    const text = await resp.text();
    expect(text).toContain("Alice Driver");
    expect(text).toContain("2026-04-26"); // date columns formatted
  });
});
