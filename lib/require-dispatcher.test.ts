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

import { requireDispatcherSession } from "@/lib/require-dispatcher";

describe("requireDispatcherSession", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    redirectMock.mockClear();
  });

  it("returns the session when the user is a dispatcher", () => {
    const session = { userId: "user-dispatcher", role: "dispatcher" as const };
    getSessionMock.mockReturnValue(session);
    expect(requireDispatcherSession()).toEqual(session);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns the session when the user is an admin", () => {
    const session = { userId: "user-admin", role: "admin" as const };
    getSessionMock.mockReturnValue(session);
    expect(requireDispatcherSession()).toEqual(session);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when the user is a driver", () => {
    getSessionMock.mockReturnValue({
      userId: "user-driver",
      role: "driver",
    });
    expect(() => requireDispatcherSession()).toThrow(/REDIRECT:\/login/);
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when there is no session", () => {
    getSessionMock.mockReturnValue(null);
    expect(() => requireDispatcherSession()).toThrow(/REDIRECT:\/login/);
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
