import { describe, expect, it } from "vitest";
import {
  defaultInviteExpiryIso,
  evaluateInvite,
  generateInviteToken,
  isValidInviteEmail,
} from "./invites";
import type { Invite } from "@/lib/types";

function mkInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    id: "i-1",
    email: "user@example.com",
    role: "office",
    token: "tok-1",
    status: "pending",
    invitedByProfileId: "admin-1",
    createdAt: "2026-04-20T00:00:00.000Z",
    expiresAt: "2026-04-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("generateInviteToken", () => {
  it("returns a base64url string of length 43 (32 bytes)", () => {
    const t = generateInviteToken();
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns a different token each call", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
  });
});

describe("defaultInviteExpiryIso", () => {
  it("returns now + 7 days as an ISO string", () => {
    const now = new Date("2026-04-20T12:00:00.000Z");
    expect(defaultInviteExpiryIso(now)).toBe("2026-04-27T12:00:00.000Z");
  });
});

describe("evaluateInvite", () => {
  const now = new Date("2026-04-23T00:00:00.000Z");

  it("returns not_found when the invite is null", () => {
    expect(evaluateInvite(null, now).status).toBe("not_found");
  });

  it("returns ok for a pending, unexpired invite", () => {
    const r = evaluateInvite(mkInvite(), now);
    expect(r.status).toBe("ok");
  });

  it("returns expired when expiresAt is in the past", () => {
    const r = evaluateInvite(
      mkInvite({ expiresAt: "2026-04-22T00:00:00.000Z" }),
      now,
    );
    expect(r.status).toBe("expired");
  });

  it("returns already_accepted when status=accepted (even if not expired)", () => {
    const r = evaluateInvite(mkInvite({ status: "accepted" }), now);
    expect(r.status).toBe("already_accepted");
  });

  it("returns revoked when status=revoked", () => {
    const r = evaluateInvite(mkInvite({ status: "revoked" }), now);
    expect(r.status).toBe("revoked");
  });
});

describe("isValidInviteEmail", () => {
  it.each([
    ["user@example.com", true],
    ["a.b.c+tag@example.co", true],
    ["", false],
    ["no-at-sign", false],
    ["@no-local.com", false],
    ["a@b", false],
    ["a@b.", false],
  ])("isValidInviteEmail(%s) → %s", (input, expected) => {
    expect(isValidInviteEmail(input)).toBe(expected);
  });
});
