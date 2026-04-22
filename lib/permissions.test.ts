import { describe, expect, it } from "vitest";
import {
  canDispatcherEditRoute,
  canDriverCheckInStop,
} from "./permissions";

const TODAY = "2026-04-22";
const TOMORROW = "2026-04-23";
const YESTERDAY = "2026-04-21";

describe("canDispatcherEditRoute", () => {
  it("dispatcher editing a route dated today → true", () => {
    expect(
      canDispatcherEditRoute({
        role: "dispatcher",
        routeDate: TODAY,
        today: TODAY,
      }),
    ).toBe(true);
  });

  it("dispatcher editing a route dated tomorrow → true", () => {
    expect(
      canDispatcherEditRoute({
        role: "dispatcher",
        routeDate: TOMORROW,
        today: TODAY,
      }),
    ).toBe(true);
  });

  it("dispatcher editing a route dated yesterday → false", () => {
    expect(
      canDispatcherEditRoute({
        role: "dispatcher",
        routeDate: YESTERDAY,
        today: TODAY,
      }),
    ).toBe(false);
  });

  it("admin editing a route dated today → true", () => {
    expect(
      canDispatcherEditRoute({
        role: "admin",
        routeDate: TODAY,
        today: TODAY,
      }),
    ).toBe(true);
  });

  it("admin editing a route dated yesterday → false", () => {
    expect(
      canDispatcherEditRoute({
        role: "admin",
        routeDate: YESTERDAY,
        today: TODAY,
      }),
    ).toBe(false);
  });

  it("driver editing a route dated today → false", () => {
    expect(
      canDispatcherEditRoute({
        role: "driver",
        routeDate: TODAY,
        today: TODAY,
      }),
    ).toBe(false);
  });

  it("defaults `today` to todayIso() when omitted", () => {
    // Route dated far in the future should always pass regardless of what
    // `todayIso()` resolves to at runtime.
    expect(
      canDispatcherEditRoute({
        role: "dispatcher",
        routeDate: "9999-12-31",
      }),
    ).toBe(true);
    // Route in the distant past should always fail.
    expect(
      canDispatcherEditRoute({
        role: "dispatcher",
        routeDate: "1970-01-01",
      }),
    ).toBe(false);
  });
});

describe("canDriverCheckInStop", () => {
  it("driver whose profileId matches the route's driverId → true", () => {
    expect(
      canDriverCheckInStop({
        role: "driver",
        profileId: "driver-1",
        routeDriverId: "driver-1",
      }),
    ).toBe(true);
  });

  it("driver whose profileId does not match → false", () => {
    expect(
      canDriverCheckInStop({
        role: "driver",
        profileId: "driver-2",
        routeDriverId: "driver-1",
      }),
    ).toBe(false);
  });

  it("admin whose id matches the route's driverId → false (admin cannot check in)", () => {
    expect(
      canDriverCheckInStop({
        role: "admin",
        profileId: "driver-1",
        routeDriverId: "driver-1",
      }),
    ).toBe(false);
  });

  it("admin whose id does not match → false", () => {
    expect(
      canDriverCheckInStop({
        role: "admin",
        profileId: "admin-1",
        routeDriverId: "driver-1",
      }),
    ).toBe(false);
  });

  it("dispatcher whose id matches → false (dispatcher cannot check in)", () => {
    expect(
      canDriverCheckInStop({
        role: "dispatcher",
        profileId: "driver-1",
        routeDriverId: "driver-1",
      }),
    ).toBe(false);
  });
});
