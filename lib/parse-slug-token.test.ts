import { describe, it, expect } from "vitest";
import {
  isValidSlugTokenSegment,
  parseSlugToken,
} from "./parse-slug-token";

describe("isValidSlugTokenSegment — relaxed validator", () => {
  it("accepts standard 12-char-token URLs", () => {
    expect(isValidSlugTokenSegment("acme-a7b2c3d4e5f6")).toBe(true);
  });

  it("accepts hyphenated slugs", () => {
    expect(isValidSlugTokenSegment("foo-bar-clinic-a1b2c3d4e5f6")).toBe(true);
  });

  it("accepts the production-style hyphenated slug + hyphenated token (the bug case)", () => {
    // Bug repro: slug='brick-internal', token='demo-brick-03'.
    // Composite URL = 'brick-internal-demo-brick-03' — the parser must
    // accept this as a valid segment shape (the actual lookup happens
    // via findOfficeByPickupUrlSegment).
    expect(isValidSlugTokenSegment("brick-internal-demo-brick-03")).toBe(
      true,
    );
  });

  it("accepts seed-style tokens with hyphens (e.g. demo-pdq-01)", () => {
    expect(isValidSlugTokenSegment("any-slug-demo-pdq-01")).toBe(true);
  });

  it("rejects empty input", () => {
    expect(isValidSlugTokenSegment("")).toBe(false);
  });

  it("rejects input with no hyphen", () => {
    expect(isValidSlugTokenSegment("singleword")).toBe(false);
  });

  it("rejects uppercase letters", () => {
    expect(isValidSlugTokenSegment("ACME-token12")).toBe(false);
  });

  it("rejects underscores and other special characters", () => {
    expect(isValidSlugTokenSegment("acme_clinic-token12")).toBe(false);
    expect(isValidSlugTokenSegment("acme-token!")).toBe(false);
  });

  it("rejects leading/trailing hyphens (no empty segments)", () => {
    expect(isValidSlugTokenSegment("-token-12")).toBe(false);
    expect(isValidSlugTokenSegment("acme-token-")).toBe(false);
  });

  it("rejects double hyphens (creates empty segment)", () => {
    expect(isValidSlugTokenSegment("acme--token12")).toBe(false);
  });
});

describe("parseSlugToken — legacy split (deprecated; use isValidSlugTokenSegment)", () => {
  it("returns slug + token using the LAST-hyphen split for valid segments", () => {
    expect(parseSlugToken("acme-a7b2c3d4e5f6")).toEqual({
      slug: "acme",
      token: "a7b2c3d4e5f6",
    });
  });

  it("returns null for invalid segments", () => {
    expect(parseSlugToken("")).toBeNull();
    expect(parseSlugToken("noseparator")).toBeNull();
  });

  it("now accepts hyphenated tokens (legacy regex was too strict)", () => {
    // Pre-fix: would have returned null because token didn't match
    // /^[a-z0-9]{12}$/. Post-fix: returns the last-hyphen split, even
    // though it's semantically wrong for this case — but callers should
    // use `findOfficeByPickupUrlSegment` (which uses the FULL segment
    // composite match) instead of trusting the split.
    const parsed = parseSlugToken("brick-internal-demo-brick-03");
    expect(parsed).not.toBeNull();
    expect(parsed?.slug).toBe("brick-internal-demo-brick");
    expect(parsed?.token).toBe("03");
  });
});
