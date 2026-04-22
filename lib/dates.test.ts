import { describe, expect, it } from "vitest";
import {
  formatDateIsoToShort,
  formatShortDateTime,
  todayIso,
} from "./dates";

describe("todayIso", () => {
  it("returns the UTC date for a mid-afternoon UTC moment", () => {
    expect(todayIso("UTC", new Date("2026-04-22T23:30:00Z"))).toBe(
      "2026-04-22",
    );
  });

  it("returns the New York date for the same UTC moment when it's still the same day ET", () => {
    expect(todayIso("America/New_York", new Date("2026-04-22T23:30:00Z"))).toBe(
      "2026-04-22",
    );
  });

  it("returns the previous day in New York when the UTC moment is just past midnight UTC", () => {
    expect(todayIso("America/New_York", new Date("2026-04-23T03:30:00Z"))).toBe(
      "2026-04-22",
    );
  });

  it("returns the next day in Auckland when the UTC moment is late UTC evening", () => {
    expect(todayIso("Pacific/Auckland", new Date("2026-04-22T23:30:00Z"))).toBe(
      "2026-04-23",
    );
  });

  it("defaults to UTC when no timezone is passed", () => {
    expect(todayIso(undefined, new Date("2026-04-22T23:30:00Z"))).toBe(
      "2026-04-22",
    );
  });
});

describe("formatShortDateTime", () => {
  it("returns an em-dash for empty input", () => {
    expect(formatShortDateTime("")).toBe("—");
  });

  it("returns an em-dash for garbage input", () => {
    expect(formatShortDateTime("not-a-date")).toBe("—");
  });

  it("formats an ISO timestamp as short date + 12-hour clock", () => {
    // Allow NBSP (U+00A0) or narrow-NBSP (U+202F) between time and
    // AM/PM — some ICU builds insert those.
    expect(formatShortDateTime("2026-04-22T14:07:00Z", "UTC")).toMatch(
      /Apr 22,\s2:07\sPM/i,
    );
  });
});

describe("formatDateIsoToShort", () => {
  it("returns month + day for an ISO date", () => {
    expect(formatDateIsoToShort("2026-04-22")).toMatch(/Apr 22/);
  });

  it("returns an em-dash for empty input", () => {
    expect(formatDateIsoToShort("")).toBe("—");
  });

  it("returns an em-dash for garbage input", () => {
    expect(formatDateIsoToShort("not-a-date")).toBe("—");
  });
});
