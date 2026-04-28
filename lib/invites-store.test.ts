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

describe("invites store (mock mode)", () => {
  beforeEach(() => {
    resetInviteStore();
  });

  it("createInvite returns a row with token, pending status, and 7-day expiry", async () => {
    const invite = await createInvite({
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

  it("getInviteByToken returns the row, or null when missing", async () => {
    const a = await createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    expect((await getInviteByToken(a.token))?.id).toBe(a.id);
    expect(await getInviteByToken("nope")).toBeNull();
  });

  it("listInvites returns newest first", async () => {
    const first = await createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = await createInvite({
      email: "b@x.com",
      role: "driver",
      invitedByProfileId: "admin-1",
    });
    const rows = await listInvites();
    expect(rows[0]?.id).toBe(second.id);
    expect(rows[1]?.id).toBe(first.id);
  });

  it("lookupInviteForAccept returns ok for a fresh pending invite", async () => {
    const invite = await createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    const r = await lookupInviteForAccept(invite.token);
    expect(r.status).toBe("ok");
  });

  it("acceptInvite flips status to accepted and stamps acceptedAt + acceptedByProfileId", async () => {
    const invite = await createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    const result = await acceptInvite(invite.token, "user-99");
    expect(result.outcome.status).toBe("ok");
    expect(result.invite?.status).toBe("accepted");
    expect(result.invite?.acceptedByProfileId).toBe("user-99");
    expect(result.invite?.acceptedAt).toBeTruthy();

    // Second accept should now report already_accepted.
    const second = await acceptInvite(invite.token, "user-99");
    expect(second.outcome.status).toBe("already_accepted");
  });

  it("acceptInvite returns not_found for an unknown token", async () => {
    const r = await acceptInvite("nope", "user-1");
    expect(r.outcome.status).toBe("not_found");
  });

  it("revokeInvite flips a pending invite to revoked and refuses to revoke twice", async () => {
    const invite = await createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    expect(await revokeInvite(invite.id)).toBe(true);
    const after = await getInviteByToken(invite.token);
    expect(after?.status).toBe("revoked");
    expect(await revokeInvite(invite.id)).toBe(false);
  });

  it("revokeInvite returns false for an unknown id", async () => {
    expect(await revokeInvite("missing")).toBe(false);
  });

  it("acceptInvite refuses a revoked invite", async () => {
    const invite = await createInvite({
      email: "a@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    await revokeInvite(invite.id);
    const r = await acceptInvite(invite.token, "user-1");
    expect(r.outcome.status).toBe("revoked");
  });
});
