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

  it("returns the session when the user is a driver", async () => {
    const session = { userId: "user-driver", role: "driver" as const };
    getSessionMock.mockResolvedValue(session);
    await expect(requireDriverSession()).resolves.toEqual(session);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when the user is an admin", async () => {
    getSessionMock.mockResolvedValue({ userId: "u", role: "admin" });
    await expect(requireDriverSession()).rejects.toThrow(/REDIRECT:\/login/);
  });

  it("redirects to /login when the user is a dispatcher", async () => {
    getSessionMock.mockResolvedValue({ userId: "u", role: "dispatcher" });
    await expect(requireDriverSession()).rejects.toThrow(/REDIRECT:\/login/);
  });

  it("redirects to /login when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(requireDriverSession()).rejects.toThrow(/REDIRECT:\/login/);
  });
});

describe("requireDriverOrAdminSession", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    redirectMock.mockClear();
  });

  it("returns the session when the user is a driver", async () => {
    const session = { userId: "u", role: "driver" as const };
    getSessionMock.mockResolvedValue(session);
    await expect(requireDriverOrAdminSession()).resolves.toEqual(session);
  });

  it("returns the session when the user is an admin", async () => {
    const session = { userId: "u", role: "admin" as const };
    getSessionMock.mockResolvedValue(session);
    await expect(requireDriverOrAdminSession()).resolves.toEqual(session);
  });

  it("redirects to /login when the user is a dispatcher", async () => {
    getSessionMock.mockResolvedValue({ userId: "u", role: "dispatcher" });
    await expect(requireDriverOrAdminSession()).rejects.toThrow(
      /REDIRECT:\/login/,
    );
  });

  it("redirects to /login when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);
    await expect(requireDriverOrAdminSession()).rejects.toThrow(
      /REDIRECT:\/login/,
    );
  });
});
