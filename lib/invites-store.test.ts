import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvite,
  createInvite,
  getInviteByToken,
  listInvites,
  lookupInviteForAccept,
  resetInviteStore,
  revokeInvite,
} from "./invites-store";

describe("invites store", () => {
  beforeEach(() => {
    resetInviteStore();
  });

  it("createInvite returns a row with token, pending status, and 7-day expiry", () => {
    const invite = createInvite({
      email: "User@Example.COM",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    expect(invite.email).toBe("user@example.com"); // normalized
    expect(invite.role).toBe("office");
    expect(invite.status).toBe("pending");
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const created = new Date(invite.createdAt).getTime();
    const expires = new Date(invite.expiresAt).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(expires - created).toBeGreaterThanOrEqual(sevenDays - 5_000);
    expect(expires - created).toBeLessThanOrEqual(sevenDays + 5_000);
  });

  it("getInviteByToken returns the row, or null when missing", () => {
    const a = createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    expect(getInviteByToken(a.token)?.id).toBe(a.id);
    expect(getInviteByToken("nope")).toBeNull();
  });

  it("listInvites returns newest first", async () => {
    const first = createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = createInvite({
      email: "b@x.com",
      role: "driver",
      invitedByProfileId: "admin-1",
    });
    const rows = listInvites();
    expect(rows[0]?.id).toBe(second.id);
    expect(rows[1]?.id).toBe(first.id);
  });

  it("lookupInviteForAccept returns ok for a fresh pending invite", () => {
    const invite = createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    const r = lookupInviteForAccept(invite.token);
    expect(r.status).toBe("ok");
  });

  it("acceptInvite flips status to accepted and stamps acceptedAt + acceptedByProfileId", () => {
    const invite = createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    const result = acceptInvite(invite.token, "user-99");
    expect(result.outcome.status).toBe("ok");
    expect(result.invite?.status).toBe("accepted");
    expect(result.invite?.acceptedByProfileId).toBe("user-99");
    expect(result.invite?.acceptedAt).toBeTruthy();

    // Second accept should now report already_accepted.
    const second = acceptInvite(invite.token, "user-99");
    expect(second.outcome.status).toBe("already_accepted");
  });

  it("acceptInvite returns not_found for an unknown token", () => {
    const r = acceptInvite("nope", "user-1");
    expect(r.outcome.status).toBe("not_found");
  });

  it("revokeInvite flips a pending invite to revoked and refuses to revoke twice", () => {
    const invite = createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    expect(revokeInvite(invite.id)).toBe(true);
    const after = getInviteByToken(invite.token);
    expect(after?.status).toBe("revoked");
    expect(revokeInvite(invite.id)).toBe(false);
  });

  it("revokeInvite returns false for an unknown id", () => {
    expect(revokeInvite("missing")).toBe(false);
  });

  it("acceptInvite refuses a revoked invite", () => {
    const invite = createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    revokeInvite(invite.id);
    const r = acceptInvite(invite.token, "user-1");
    expect(r.outcome.status).toBe("revoked");
  });
});
