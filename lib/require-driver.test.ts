import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  requireDriverOrAdminSession,
  requireDriverSession,
} from "@/lib/require-driver";

describe("requireDriverSession (strict)", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    redirectMock.mockClear();
  });

  it("returns the session when the user is a driver", () => {
    const session = { userId: "user-driver", role: "driver" as const };
    getSessionMock.mockReturnValue(session);
    expect(requireDriverSession()).toEqual(session);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when the user is an admin", () => {
    getSessionMock.mockReturnValue({ userId: "u", role: "admin" });
    expect(() => requireDriverSession()).toThrow(/REDIRECT:\/login/);
  });

  it("redirects to /login when the user is a dispatcher", () => {
    getSessionMock.mockReturnValue({ userId: "u", role: "dispatcher" });
    expect(() => requireDriverSession()).toThrow(/REDIRECT:\/login/);
  });

  it("redirects to /login when there is no session", () => {
    getSessionMock.mockReturnValue(null);
    expect(() => requireDriverSession()).toThrow(/REDIRECT:\/login/);
  });
});

describe("requireDriverOrAdminSession", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    redirectMock.mockClear();
  });

  it("returns the session when the user is a driver", () => {
    const session = { userId: "u", role: "driver" as const };
    getSessionMock.mockReturnValue(session);
    expect(requireDriverOrAdminSession()).toEqual(session);
  });

  it("returns the session when the user is an admin", () => {
    const session = { userId: "u", role: "admin" as const };
    getSessionMock.mockReturnValue(session);
    expect(requireDriverOrAdminSession()).toEqual(session);
  });

  it("redirects to /login when the user is a dispatcher", () => {
    getSessionMock.mockReturnValue({ userId: "u", role: "dispatcher" });
    expect(() => requireDriverOrAdminSession()).toThrow(/REDIRECT:\/login/);
  });

  it("redirects to /login when there is no session", () => {
    getSessionMock.mockReturnValue(null);
    expect(() => requireDriverOrAdminSession()).toThrow(/REDIRECT:\/login/);
  });
});
