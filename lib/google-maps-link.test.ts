import { describe, expect, it } from "vitest";
import { googleMapsRouteUrl } from "./google-maps-link";

const A = { lat: 40.1, lng: -74.1 };
const B = { lat: 40.2, lng: -74.2 };
const C = { lat: 40.3, lng: -74.3 };
const D = { lat: 40.4, lng: -74.4 };

describe("googleMapsRouteUrl", () => {
  it("returns null when no stops", () => {
    expect(googleMapsRouteUrl([])).toBeNull();
  });

  it("builds a single-destination URL when given one stop", () => {
    const url = new URL(googleMapsRouteUrl([A])!);
    expect(url.searchParams.get("destination")).toBe("40.1,-74.1");
    expect(url.searchParams.get("travelmode")).toBe("driving");
    expect(url.searchParams.has("waypoints")).toBe(false);
  });

  it("two-stop trip uses first as origin, second as destination, no waypoints", () => {
    const url = new URL(googleMapsRouteUrl([A, B])!);
    expect(url.searchParams.get("origin")).toBe("40.1,-74.1");
    expect(url.searchParams.get("destination")).toBe("40.2,-74.2");
    expect(url.searchParams.has("waypoints")).toBe(false);
  });

  it("four-stop trip puts the middle two as waypoints", () => {
    const url = new URL(googleMapsRouteUrl([A, B, C, D])!);
    expect(url.searchParams.get("origin")).toBe("40.1,-74.1");
    expect(url.searchParams.get("destination")).toBe("40.4,-74.4");
    expect(url.searchParams.get("waypoints")).toBe("40.2,-74.2|40.3,-74.3");
  });
});
