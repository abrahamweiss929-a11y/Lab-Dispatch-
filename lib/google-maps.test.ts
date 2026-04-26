import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetGoogleMapsCache,
  getDriveTimes,
  optimizeRoute,
} from "./google-maps";

const ORIG = { lat: 40.0, lng: -74.0 };
const A = { lat: 40.1, lng: -74.1 };
const B = { lat: 40.2, lng: -74.2 };
const C = { lat: 40.3, lng: -74.3 };

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("google-maps adapter", () => {
  beforeEach(() => {
    __resetGoogleMapsCache();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  describe("getDriveTimes", () => {
    it("returns durations for each destination", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          status: "OK",
          rows: [
            {
              elements: [
                { status: "OK", duration_in_traffic: { value: 600 } },
                { status: "OK", duration_in_traffic: { value: 900 } },
              ],
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await getDriveTimes(ORIG, [A, B]);
      expect(result).toEqual({ durationsSeconds: [600, 900] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.searchParams.get("traffic_model")).toBe("best_guess");
      expect(url.searchParams.get("departure_time")).toBe("now");
      expect(url.searchParams.get("destinations")).toBe(
        "40.1,-74.1|40.2,-74.2",
      );
    });

    it("falls back to duration when duration_in_traffic missing", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          status: "OK",
          rows: [
            {
              elements: [{ status: "OK", duration: { value: 300 } }],
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const result = await getDriveTimes(ORIG, [A]);
      expect(result).toEqual({ durationsSeconds: [300] });
    });

    it("returns null and warns when API key is missing", async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const result = await getDriveTimes(ORIG, [A]);
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
    });

    it("returns null when HTTP request fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 })),
      );
      const result = await getDriveTimes(ORIG, [A]);
      expect(result).toBeNull();
    });

    it("returns null when API status is not OK", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonResponse({ status: "REQUEST_DENIED", rows: [] }),
        ),
      );
      const result = await getDriveTimes(ORIG, [A]);
      expect(result).toBeNull();
    });

    it("returns null when an element has non-OK status", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonResponse({
            status: "OK",
            rows: [
              {
                elements: [{ status: "ZERO_RESULTS" }],
              },
            ],
          }),
        ),
      );
      const result = await getDriveTimes(ORIG, [A]);
      expect(result).toBeNull();
    });

    it("returns null on fetch throw and scrubs key from log", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(
          new Error("network blew up at key=test-key please help"),
        ),
      );
      const result = await getDriveTimes(ORIG, [A]);
      expect(result).toBeNull();
      const warnArgs = (console.warn as unknown as { mock: { calls: unknown[][] } })
        .mock.calls.flat()
        .join(" ");
      expect(warnArgs).not.toContain("test-key");
      expect(warnArgs).toContain("[redacted]");
    });

    it("caches identical queries within 15-min window", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          status: "OK",
          rows: [
            { elements: [{ status: "OK", duration_in_traffic: { value: 60 } }] },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      await getDriveTimes(ORIG, [A]);
      await getDriveTimes(ORIG, [A]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("returns empty array without fetching when destinations empty", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const result = await getDriveTimes(ORIG, []);
      expect(result).toEqual({ durationsSeconds: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("optimizeRoute", () => {
    it("returns waypoint_order and totalSeconds from API", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          status: "OK",
          routes: [
            {
              waypoint_order: [2, 0, 1],
              legs: [
                { duration_in_traffic: { value: 100 } },
                { duration_in_traffic: { value: 200 } },
                { duration_in_traffic: { value: 300 } },
                { duration_in_traffic: { value: 400 } },
              ],
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await optimizeRoute(ORIG, [A, B, C], ORIG);
      expect(result).toEqual({ order: [2, 0, 1], totalSeconds: 1000 });
      const url = fetchMock.mock.calls[0][0] as URL;
      expect(url.searchParams.get("waypoints")).toBe(
        "optimize:true|40.1,-74.1|40.2,-74.2|40.3,-74.3",
      );
    });

    it("returns null when waypoint_order length mismatches input", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonResponse({
            status: "OK",
            routes: [
              {
                waypoint_order: [0],
                legs: [
                  { duration_in_traffic: { value: 1 } },
                  { duration_in_traffic: { value: 2 } },
                ],
              },
            ],
          }),
        ),
      );
      const result = await optimizeRoute(ORIG, [A, B], ORIG);
      expect(result).toBeNull();
    });

    it("returns null on non-OK API status", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonResponse({ status: "ZERO_RESULTS", routes: [] }),
        ),
      );
      const result = await optimizeRoute(ORIG, [A], ORIG);
      expect(result).toBeNull();
    });

    it("returns empty result without fetch when waypoints empty", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const result = await optimizeRoute(ORIG, [], ORIG);
      expect(result).toEqual({ order: [], totalSeconds: 0 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns null when API key is missing", async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      const result = await optimizeRoute(ORIG, [A], ORIG);
      expect(result).toBeNull();
    });
  });
});
