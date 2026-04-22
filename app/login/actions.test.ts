import { describe, expect, it } from "vitest";
import { isSafeNext } from "@/lib/auth-rules";

describe("isSafeNext", () => {
  it("accepts a plain same-origin path", () => {
    expect(isSafeNext("/driver")).toBe(true);
  });

  it("accepts the root path", () => {
    expect(isSafeNext("/")).toBe(true);
  });

  it("rejects protocol-relative URLs (//evil.com)", () => {
    expect(isSafeNext("//evil.com")).toBe(false);
  });

  it("rejects /\\evil.com (browsers normalize backslash to forward-slash)", () => {
    expect(isSafeNext("/\\evil.com")).toBe(false);
  });

  it("rejects absolute URLs with a scheme", () => {
    expect(isSafeNext("http://evil.com")).toBe(false);
  });

  it("rejects paths containing a NUL byte", () => {
    expect(isSafeNext("/path\x00null")).toBe(false);
  });

  it("rejects paths containing a line-feed", () => {
    expect(isSafeNext("/path\nfoo")).toBe(false);
  });

  it("rejects paths containing a carriage-return", () => {
    expect(isSafeNext("/path\rfoo")).toBe(false);
  });

  it("rejects paths containing a backslash anywhere", () => {
    expect(isSafeNext("/path\\back")).toBe(false);
  });

  it("rejects javascript: pseudo-URLs", () => {
    expect(isSafeNext("javascript:alert(1)")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isSafeNext("")).toBe(false);
  });
});
