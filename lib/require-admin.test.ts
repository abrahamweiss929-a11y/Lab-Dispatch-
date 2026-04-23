import { describe, expect, it, vi, beforeEach } from "vitest";

const getSessionMock = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});

vi.mock("@/lib/session", () => ({
  getSession: () => getSessionMock(),
  SESSION_COOKIE: "ld_session",
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

import { requireAdminSession } from "@/lib/require-admin";

describe("requireAdminSession", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    redirectMock.mockClear();
  });

  it("returns the session when the user is an admin", async () => {
    const session = { userId: "user-admin", role: "admin" as const };
    getSessionMock.mockResolvedValue(session);
    await expect(requireAdminSession()).resolves.toEqual(session);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when the user is a dispatcher", async () => {
    getSessionMock.mockResolvedValue({
      userId: "user-dispatcher",
      role: "dispatcher",
    });
    await expect(requireAdminSession()).rejects.toThrow(/REDIRECT:\/login/);
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(requireAdminSession()).rejects.toThrow(/REDIRECT:\/login/);
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
