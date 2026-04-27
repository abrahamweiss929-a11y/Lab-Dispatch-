import { describe, expect, it, vi, beforeEach } from "vitest";

const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
const requireAdminSessionMock = vi.fn(() => ({
  userId: "admin-test",
  role: "admin" as const,
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

vi.mock("@/lib/require-admin", () => ({
  requireAdminSession: () => requireAdminSessionMock(),
}));

import { createInviteAction, revokeInviteAction } from "./actions";
import { INITIAL_CREATE_INVITE_STATE } from "./form-state";
import {
  getInviteByToken,
  listInvites,
  resetInviteStore,
} from "@/lib/invites-store";
import { getSentEmails, resetEmailMock } from "@/mocks/email";

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    form.set(key, value);
  }
  return form;
}

describe("admin/users server actions — createInviteAction", () => {
  beforeEach(() => {
    resetInviteStore();
    resetEmailMock();
    revalidatePathMock.mockClear();
    redirectMock.mockClear();
    requireAdminSessionMock.mockReset();
    requireAdminSessionMock.mockReturnValue({
      userId: "admin-test",
      role: "admin",
    });
  });

  it("happy path: creates an invite, revalidates /admin/users, returns ok with token URL", async () => {
    const result = await createInviteAction(
      INITIAL_CREATE_INVITE_STATE,
      fd({ email: "user@example.com", role: "office" }),
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.invite.email).toBe("user@example.com");
    expect(result.invite.role).toBe("office");
    expect(result.acceptUrl).toBe(`/invite/${result.invite.token}`);
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/users");

    const stored = listInvites();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.invitedByProfileId).toBe("admin-test");
  });

  it("rejects an invalid email", async () => {
    const result = await createInviteAction(
      INITIAL_CREATE_INVITE_STATE,
      fd({ email: "not-an-email", role: "office" }),
    );
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.fieldErrors.email).toBeTruthy();
    expect(listInvites()).toHaveLength(0);
  });

  it("rejects an invalid role", async () => {
    const result = await createInviteAction(
      INITIAL_CREATE_INVITE_STATE,
      fd({ email: "user@example.com", role: "admin" }),
    );
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.fieldErrors.role).toBeTruthy();
    expect(listInvites()).toHaveLength(0);
  });

  it("bails when not an admin", async () => {
    requireAdminSessionMock.mockImplementationOnce(() => {
      throw new Error("REDIRECT:/login");
    });
    await expect(
      createInviteAction(
        INITIAL_CREATE_INVITE_STATE,
        fd({ email: "user@example.com", role: "office" }),
      ),
    ).rejects.toThrow(/REDIRECT:\/login/);
    expect(listInvites()).toHaveLength(0);
  });

  it("sends an invite email with the absolute /invite/{token} URL", async () => {
    const result = await createInviteAction(
      INITIAL_CREATE_INVITE_STATE,
      fd({ email: "newhire@example.com", role: "office" }),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const sent = getSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("newhire@example.com");
    expect(sent[0]?.subject).toBe(
      "You've been invited to Lab Dispatch as office staff",
    );
    expect(sent[0]?.textBody).toContain(
      `https://labdispatch.app/invite/${result.invite.token}`,
    );
    expect(sent[0]?.textBody).toContain("office staff");
    // HTML version is also sent.
    expect(sent[0]?.htmlBody).toContain(
      `https://labdispatch.app/invite/${result.invite.token}`,
    );
  });

  it("returns ok even when the invite email send throws (failure isolated)", async () => {
    // Force the email mock to fail by passing an invalid email — but
    // the validation rejects it earlier. Instead, we patch the email
    // service for one call.
    const services = (await import("@/interfaces")).getServices();
    const original = services.email.sendEmail;
    services.email.sendEmail = async () => {
      throw new Error("Postmark down");
    };
    try {
      const result = await createInviteAction(
        INITIAL_CREATE_INVITE_STATE,
        fd({ email: "newhire@example.com", role: "driver" }),
      );
      expect(result.status).toBe("ok");
      // Invite still persisted despite email failure
      expect(listInvites()).toHaveLength(1);
    } finally {
      services.email.sendEmail = original;
    }
  });
});

describe("admin/users server actions — revokeInviteAction", () => {
  beforeEach(() => {
    resetInviteStore();
    resetEmailMock();
    revalidatePathMock.mockClear();
    requireAdminSessionMock.mockReset();
    requireAdminSessionMock.mockReturnValue({
      userId: "admin-test",
      role: "admin",
    });
  });

  it("flips the invite to revoked and revalidates", async () => {
    const created = await createInviteAction(
      INITIAL_CREATE_INVITE_STATE,
      fd({ email: "user@example.com", role: "office" }),
    );
    if (created.status !== "ok") throw new Error("setup failed");
    revalidatePathMock.mockClear();

    await revokeInviteAction(created.invite.id);

    const after = getInviteByToken(created.invite.token);
    expect(after?.status).toBe("revoked");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/users");
  });

  it("bails when not an admin", async () => {
    requireAdminSessionMock.mockImplementationOnce(() => {
      throw new Error("REDIRECT:/login");
    });
    await expect(revokeInviteAction("any")).rejects.toThrow(/REDIRECT:\/login/);
  });
});
