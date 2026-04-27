import { describe, expect, it } from "vitest";
import {
  googleMapsRouteUrl,
  googleMapsRouteUrlFromAddresses,
  googleMapsSingleStopUrl,
} from "./google-maps-link";

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

describe("googleMapsSingleStopUrl", () => {
  it("encodes a plain address", () => {
    const url = new URL(
      googleMapsSingleStopUrl("123 Main St, Princeton, NJ 08540"),
    );
    expect(url.searchParams.get("destination")).toBe(
      "123 Main St, Princeton, NJ 08540",
    );
    expect(url.searchParams.get("travelmode")).toBe("driving");
    expect(url.searchParams.get("api")).toBe("1");
  });

  it("preserves accented characters and special punctuation through encoding", () => {
    const raw = "Café & Co., 12 Rue de l'Église, Montréal";
    const urlString = googleMapsSingleStopUrl(raw);
    const url = new URL(urlString);
    expect(url.searchParams.get("destination")).toBe(raw);
  });
});

describe("googleMapsRouteUrlFromAddresses", () => {
  it("returns null when given no addresses", () => {
    expect(googleMapsRouteUrlFromAddresses([])).toBeNull();
  });

  it("uses single-destination form when given one address", () => {
    const out = googleMapsRouteUrlFromAddresses(["1 Main St"])!;
    const url = new URL(out);
    expect(url.searchParams.get("destination")).toBe("1 Main St");
    // Single-stop helper deliberately omits origin — Google uses device
    // location automatically.
    expect(url.searchParams.has("origin")).toBe(false);
  });

  it("for 4 stops: origin=My Location, destination=last, waypoints=first three", () => {
    const out = googleMapsRouteUrlFromAddresses([
      "1 First Ave",
      "2 Second Ave",
      "3 Third Ave",
      "4 Fourth Ave",
    ])!;
    const url = new URL(out);
    expect(url.searchParams.get("origin")).toBe("My Location");
    expect(url.searchParams.get("destination")).toBe("4 Fourth Ave");
    expect(url.searchParams.get("waypoints")).toBe(
      "1 First Ave|2 Second Ave|3 Third Ave",
    );
    expect(url.searchParams.get("travelmode")).toBe("driving");
  });

  it("caps waypoints at 9 when given 11 addresses (Google's hard limit)", () => {
    const addrs = [
      "stop-01",
      "stop-02",
      "stop-03",
      "stop-04",
      "stop-05",
      "stop-06",
      "stop-07",
      "stop-08",
      "stop-09",
      "stop-10",
      "stop-11",
    ];
    const out = googleMapsRouteUrlFromAddresses(addrs)!;
    const url = new URL(out);
    // 11 input → 1 destination ("stop-11") + 10 candidate waypoints
    // (stop-01..stop-10) → trimmed to 9 waypoints from the front.
    expect(url.searchParams.get("destination")).toBe("stop-11");
    const waypoints = url.searchParams.get("waypoints")!.split("|");
    expect(waypoints).toHaveLength(9);
    expect(waypoints[0]).toBe("stop-01");
    expect(waypoints[8]).toBe("stop-09");
  });

  it("9-stop trip uses 1 destination + 8 waypoints (under cap)", () => {
    const addrs = [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
    ];
    const url = new URL(googleMapsRouteUrlFromAddresses(addrs)!);
    expect(url.searchParams.get("destination")).toBe("i");
    expect(url.searchParams.get("waypoints")?.split("|")).toHaveLength(8);
  });

  it("encodes commas and special chars in addresses correctly", () => {
    const out = googleMapsRouteUrlFromAddresses([
      "Acme & Co., 1 Main St",
      "Lab Corp, 2 Park Ave",
    ])!;
    const url = new URL(out);
    expect(url.searchParams.get("destination")).toBe(
      "Lab Corp, 2 Park Ave",
    );
    expect(url.searchParams.get("waypoints")).toBe(
      "Acme & Co., 1 Main St",
    );
    // Verify the actual URL-encoded form preserves & via encoding.
    expect(out).toContain("%26");
  });
});
