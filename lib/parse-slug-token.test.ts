import { describe, it, expect } from "vitest";
import { parseSlugToken } from "./parse-slug-token";

describe("parseSlugToken", () => {
  it("parses a single-hyphen slug + 12-char token", () => {
    expect(parseSlugToken("acme-a7b2c3d4e5f6")).toEqual({
      slug: "acme",
      token: "a7b2c3d4e5f6",
    });
  });

  it("parses a multi-hyphen slug by splitting on the LAST hyphen", () => {
    expect(parseSlugToken("foo-bar-clinic-a1b2c3d4e5f6")).toEqual({
      slug: "foo-bar-clinic",
      token: "a1b2c3d4e5f6",
    });
  });

  it("accepts a numeric-only slug", () => {
    expect(parseSlugToken("123-a1b2c3d4e5f6")).toEqual({
      slug: "123",
      token: "a1b2c3d4e5f6",
    });
  });

  it("rejects uppercase in the token", () => {
    expect(parseSlugToken("acme-A7B2C3D4E5F6")).toBeNull();
  });

  it("rejects a token that is too short", () => {
    expect(parseSlugToken("acme-SHORT")).toBeNull();
    expect(parseSlugToken("acme-a7b2c3d4e5f")).toBeNull();
  });

  it("rejects a token that is too long", () => {
    expect(parseSlugToken("acme-a7b2c3d4e5f6x")).toBeNull();
  });

  it("rejects non-alphanumeric token characters", () => {
    expect(parseSlugToken("acme-a7b2c3d4e5f_")).toBeNull();
    expect(parseSlugToken("acme-a7b2c3d4e5f!")).toBeNull();
  });

  it("rejects input with no hyphen", () => {
    expect(parseSlugToken("acme")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(parseSlugToken("")).toBeNull();
  });

  it("rejects a leading-dash input (empty slug)", () => {
    expect(parseSlugToken("-a7b2c3d4e5f6")).toBeNull();
  });

  it("rejects a slug with non-allowed characters", () => {
    expect(parseSlugToken("ACME-a7b2c3d4e5f6")).toBeNull();
    expect(parseSlugToken("acme_clinic-a7b2c3d4e5f6")).toBeNull();
  });
});
