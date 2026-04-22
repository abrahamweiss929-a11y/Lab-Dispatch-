import { describe, it, expect } from "vitest";
import { mapsMock } from "./maps";

describe("mapsMock", () => {
  it("geocode is deterministic for a fixed input", async () => {
    const address = "100 Main St, Princeton, NJ";
    let sum = 0;
    for (let i = 0; i < address.length; i += 1) {
      sum += address.charCodeAt(i);
    }
    const expectedLat = 40.0 + (sum % 1000) / 10000;
    const expectedLng = -74.0 + (sum % 2000) / 10000;

    const first = await mapsMock.geocode(address);
    const second = await mapsMock.geocode(address);
    expect(first).toEqual({ lat: expectedLat, lng: expectedLng });
    expect(second).toEqual(first);
  });

  it("routeFor returns deterministic distance/duration/polyline for n stops", async () => {
    const stops = [
      { lat: 40.0, lng: -74.0 },
      { lat: 40.1, lng: -74.1 },
      { lat: 40.2, lng: -74.2 },
    ];
    const result = await mapsMock.routeFor({ stops });
    expect(result.distanceMeters).toBe(3000);
    expect(result.durationSeconds).toBe(360);
    expect(result.polyline).toBe("mock-polyline:40,-74|40.1,-74.1|40.2,-74.2");
  });

  it("routeFor with empty stops returns zeros and an empty polyline", async () => {
    const result = await mapsMock.routeFor({ stops: [] });
    expect(result.distanceMeters).toBe(0);
    expect(result.durationSeconds).toBe(0);
    expect(result.polyline).toBe("mock-polyline:");
  });

  it("etaFor is symmetric between two points", async () => {
    const a = { lat: 40.0, lng: -74.0 };
    const b = { lat: 40.5, lng: -74.5 };
    const fwd = await mapsMock.etaFor({ from: a, to: b });
    const rev = await mapsMock.etaFor({ from: b, to: a });
    expect(fwd.durationSeconds).toBe(rev.durationSeconds);
    expect(fwd.durationSeconds).toBeGreaterThan(0);
  });
});
