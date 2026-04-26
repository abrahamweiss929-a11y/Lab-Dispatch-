import { describe, expect, it, vi, beforeEach } from "vitest";

const redirectMock = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
const setSessionMock = vi.fn<[string, string], Promise<void>>(async () => {});

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

vi.mock("@/lib/session", () => ({
  setSession: (userId: string, role: string) => setSessionMock(userId, role),
}));

import {
  INITIAL_ACCEPT_INVITE_STATE,
  acceptInviteAction,
} from "./actions";
import {
  createInvite,
  getInviteByToken,
  resetInviteStore,
  revokeInvite,
} from "@/lib/invites-store";
import { getSentEmails, resetEmailMock } from "@/mocks/email";

describe("invite accept action", () => {
  beforeEach(() => {
    resetInviteStore();
    resetEmailMock();
    redirectMock.mockClear();
    setSessionMock.mockReset();
  });

  it("happy path: accepts invite, sets session, redirects to landing", async () => {
    const invite = createInvite({
      email: "u@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });

    await expect(
      acceptInviteAction(invite.token, INITIAL_ACCEPT_INVITE_STATE),
    ).rejects.toThrow(/REDIRECT:\/dispatcher/);

    expect(setSessionMock).toHaveBeenCalledTimes(1);
    expect(setSessionMock.mock.calls[0]?.[1]).toBe("office");

    const after = getInviteByToken(invite.token);
    expect(after?.status).toBe("accepted");
    expect(after?.acceptedByProfileId).toBeTruthy();
  });

  it("driver invite redirects to /driver landing", async () => {
    const invite = createInvite({
      email: "d@x.com",
      role: "driver",
      invitedByProfileId: "admin-1",
    });

    await expect(
      acceptInviteAction(invite.token, INITIAL_ACCEPT_INVITE_STATE),
    ).rejects.toThrow(/REDIRECT:\/driver/);
    expect(setSessionMock.mock.calls[0]?.[1]).toBe("driver");
  });

  it("returns not_found error for an unknown token (no session set)", async () => {
    const result = await acceptInviteAction(
      "nonexistent",
      INITIAL_ACCEPT_INVITE_STATE,
    );
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.reason).toBe("not_found");
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it("returns revoked error after the invite is revoked", async () => {
    const invite = createInvite({
      email: "u@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });
    revokeInvite(invite.id);
    const result = await acceptInviteAction(
      invite.token,
      INITIAL_ACCEPT_INVITE_STATE,
    );
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.reason).toBe("revoked");
  });

  it("sends a welcome email after accepting (office role -> /dispatcher landing url)", async () => {
    const invite = createInvite({
      email: "newhire@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });

    await expect(
      acceptInviteAction(invite.token, INITIAL_ACCEPT_INVITE_STATE),
    ).rejects.toThrow(/REDIRECT/);

    const sent = getSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("newhire@x.com");
    expect(sent[0]?.subject).toBe("Welcome to Lab Dispatch");
    expect(sent[0]?.textBody).toContain(
      "https://labdispatch.app/dispatcher",
    );
  });

  it("redirect succeeds even when welcome email fails (failure isolated)", async () => {
    const invite = createInvite({
      email: "newhire@x.com",
      role: "driver",
      invitedByProfileId: "admin-1",
    });

    const services = (await import("@/interfaces")).getServices();
    const original = services.email.sendEmail;
    services.email.sendEmail = async () => {
      throw new Error("Postmark down");
    };
    try {
      await expect(
        acceptInviteAction(invite.token, INITIAL_ACCEPT_INVITE_STATE),
      ).rejects.toThrow(/REDIRECT:\/driver/);
    } finally {
      services.email.sendEmail = original;
    }
    // Invite still marked accepted
    expect(getInviteByToken(invite.token)?.status).toBe("accepted");
  });

  it("returns already_accepted on second use of the same token", async () => {
    const invite = createInvite({
      email: "u@x.com",
      role: "office",
      invitedByProfileId: "admin-1",
    });

    // First accept — redirects.
    await expect(
      acceptInviteAction(invite.token, INITIAL_ACCEPT_INVITE_STATE),
    ).rejects.toThrow(/REDIRECT/);

    // Second accept — error, no session set.
    setSessionMock.mockClear();
    const second = await acceptInviteAction(
      invite.token,
      INITIAL_ACCEPT_INVITE_STATE,
    );
    expect(second.status).toBe("error");
    if (second.status !== "error") return;
    expect(second.reason).toBe("already_accepted");
    expect(setSessionMock).not.toHaveBeenCalled();
  });
});
