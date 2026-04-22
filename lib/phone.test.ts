import { describe, expect, it } from "vitest";
import { normalizeUsPhone } from "./phone";

describe("normalizeUsPhone", () => {
  it("normalizes a formatted 11-digit number with country code and punctuation", () => {
    expect(normalizeUsPhone("+1 (555) 123-4567")).toBe("+15551234567");
  });

  it("normalizes a 10-digit dashed number to +1 form", () => {
    expect(normalizeUsPhone("555-123-4567")).toBe("+15551234567");
  });

  it("normalizes a bare 10-digit number", () => {
    expect(normalizeUsPhone("5551234567")).toBe("+15551234567");
  });

  it("normalizes 11 digits starting with 1", () => {
    expect(normalizeUsPhone("15551234567")).toBe("+15551234567");
  });

  it("passes through +15551234567 unchanged", () => {
    expect(normalizeUsPhone("+15551234567")).toBe("+15551234567");
  });

  it("returns null for an empty string", () => {
    expect(normalizeUsPhone("")).toBeNull();
  });

  it("returns null for letter-only tokens that collapse below 10 digits", () => {
    // "1-800-FLOWERS" → "1800" after stripping non-digits → 4 digits → null.
    expect(normalizeUsPhone("1-800-FLOWERS")).toBeNull();
  });

  it("returns null for a non-US country code (e.g. UK +44)", () => {
    expect(normalizeUsPhone("+44 20 1234 5678")).toBeNull();
  });

  it("returns null for too-short input", () => {
    expect(normalizeUsPhone("123")).toBeNull();
  });

  it("returns null for too-long input", () => {
    expect(normalizeUsPhone("123456789012")).toBeNull();
  });

  it("returns null for 11 digits that do not start with 1", () => {
    expect(normalizeUsPhone("25551234567")).toBeNull();
  });
});
