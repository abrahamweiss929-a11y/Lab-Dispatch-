import { describe, it, expect } from "vitest";
import { makeRandomId, makeSlugId } from "./ids";

describe("makeRandomId", () => {
  it("returns a string of the default length 8 matching the base36 character class", () => {
    const id = makeRandomId();
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[a-z0-9]{8}$/);
  });

  it("honors an explicit size and still matches the base36 character class", () => {
    const id = makeRandomId(16);
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[a-z0-9]{16}$/);
  });

  it("throws RangeError for out-of-range sizes", () => {
    expect(() => makeRandomId(0)).toThrow(RangeError);
    expect(() => makeRandomId(33)).toThrow(RangeError);
  });
});

describe("makeSlugId", () => {
  it("normalizes the slug and appends a random suffix", () => {
    const id = makeSlugId("Dr. Smith's Office!");
    expect(id).toMatch(/^dr-smith-s-office-[a-z0-9]{8}$/);
  });

  it("throws when the slug normalizes to an empty string", () => {
    expect(() => makeSlugId("   ")).toThrow();
    expect(() => makeSlugId("!!!")).toThrow();
  });

  it("flows an explicit size through to the random suffix", () => {
    const id = makeSlugId("office", 12);
    expect(id).toMatch(/^office-[a-z0-9]{12}$/);
  });
});

describe("uniqueness", () => {
  it("generates 1000 unique makeRandomId values at size 8", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      set.add(makeRandomId());
    }
    expect(set.size).toBe(1000);
  });

  it("generates 1000 unique makeSlugId values for the same slug", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      set.add(makeSlugId("office"));
    }
    expect(set.size).toBe(1000);
  });
});
