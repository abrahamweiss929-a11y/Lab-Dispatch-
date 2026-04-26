import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetGoogleMapsCache } from "./google-maps";
import {
  buildRouteSummary,
  formatDriveSeconds,
  formatHourMinute,
} from "./route-summary";

const ORIG = { lat: 40.0, lng: -74.0 };
const A = { lat: 40.1, lng: -74.1 };
const B = { lat: 40.2, lng: -74.2 };

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockDriveSeconds(values: number[]) {
  // The adapter calls Distance Matrix once per leg in our usage. Return
  // one value per call.
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      const v = values[i++];
      return jsonResponse({
        status: "OK",
        rows: [
          {
            elements: [
              { status: "OK", duration_in_traffic: { value: v } },
            ],
          },
        ],
      });
    }),
  );
}

describe("buildRouteSummary", () => {
  const NOW = new Date("2026-04-26T13:00:00Z");

  beforeEach(() => {
    __resetGoogleMapsCache();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it("returns empty summary when no stops", async () => {
    const summary = await buildRouteSummary(ORIG, [], NOW);
    expect(summary.remainingStops).toBe(0);
    expect(summary.totalMinutes).toBe(0);
    expect(summary.fromGoogle).toBe(false);
  });

  it("computes drive + pickup minutes from Google data", async () => {
    mockDriveSeconds([600, 900]); // 10m + 15m drive
    const summary = await buildRouteSummary(ORIG, [A, B], NOW);
    expect(summary.fromGoogle).toBe(true);
    expect(summary.remainingStops).toBe(2);
    expect(summary.driveMinutes).toBe(25);
    expect(summary.pickupMinutes).toBe(14); // 7 × 2
    expect(summary.totalMinutes).toBe(39);
    expect(summary.driveSecondsPerLeg).toEqual([600, 900]);
  });

  it("ETA per stop accumulates drive + dwell between stops", async () => {
    mockDriveSeconds([600, 900]);
    const summary = await buildRouteSummary(ORIG, [A, B], NOW);
    // Stop A: NOW + 10m = 13:10
    expect(summary.etaIsoPerStop[0]).toBe("2026-04-26T13:10:00.000Z");
    // Stop B: 13:10 + 7m dwell at A + 15m drive = 13:32
    expect(summary.etaIsoPerStop[1]).toBe("2026-04-26T13:32:00.000Z");
  });

  it("falls back when Google returns null and uses 12-min default per leg", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const summary = await buildRouteSummary(ORIG, [A, B], NOW);
    expect(summary.fromGoogle).toBe(false);
    expect(summary.driveSecondsPerLeg).toEqual([720, 720]);
    expect(summary.driveMinutes).toBe(24);
  });
});

describe("formatHourMinute", () => {
  it("formats ISO to h:mm a in UTC", () => {
    expect(formatHourMinute("2026-04-26T13:30:00Z")).toBe("1:30 PM");
  });
  it("returns em-dash for invalid", () => {
    expect(formatHourMinute("not a date")).toBe("—");
  });
});

describe("formatDriveSeconds", () => {
  it("rounds to nearest minute, floor of 1m", () => {
    expect(formatDriveSeconds(600)).toBe("10m");
    expect(formatDriveSeconds(20)).toBe("1m");
    expect(formatDriveSeconds(0)).toBe("1m");
  });
});
