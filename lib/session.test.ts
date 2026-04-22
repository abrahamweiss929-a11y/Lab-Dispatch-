import { describe, expect, it } from "vitest";
import { decodeSession, encodeSession } from "@/lib/session";

describe("session codec", () => {
  it("round-trips a valid session", () => {
    const value = { userId: "u1", role: "admin" as const };
    const encoded = encodeSession(value);
    expect(decodeSession(encoded)).toEqual(value);
  });

  it("round-trips each role", () => {
    for (const role of ["driver", "dispatcher", "admin"] as const) {
      const encoded = encodeSession({ userId: "x", role });
      expect(decodeSession(encoded)).toEqual({ userId: "x", role });
    }
  });

  it("returns null for undefined cookie", () => {
    expect(decodeSession(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(decodeSession("")).toBeNull();
  });

  it("returns null for non-base64 garbage", () => {
    // Characters that cannot form a valid base64 payload decoding to JSON.
    expect(decodeSession("!!!")).toBeNull();
  });

  it("returns null for base64 of non-JSON", () => {
    const raw = Buffer.from("hello", "utf8").toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null for base64 of JSON with empty object", () => {
    const raw = Buffer.from(JSON.stringify({}), "utf8").toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null when role is unknown", () => {
    const raw = Buffer.from(
      JSON.stringify({ userId: "u1", role: "hacker" }),
      "utf8",
    ).toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null when userId is numeric", () => {
    const raw = Buffer.from(
      JSON.stringify({ userId: 42, role: "admin" }),
      "utf8",
    ).toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null when userId is empty string", () => {
    const raw = Buffer.from(
      JSON.stringify({ userId: "", role: "admin" }),
      "utf8",
    ).toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null when role is missing", () => {
    const raw = Buffer.from(
      JSON.stringify({ userId: "u1" }),
      "utf8",
    ).toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null when payload is JSON null", () => {
    const raw = Buffer.from(JSON.stringify(null), "utf8").toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });
});
