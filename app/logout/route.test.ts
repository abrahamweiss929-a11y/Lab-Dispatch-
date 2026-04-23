import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const clearSessionMock = vi.fn(async () => undefined);
const mockServicesSignOut = vi.fn(async () => undefined);
const realSignOutMock = vi.fn(async () => undefined);

vi.mock("@/lib/session", () => ({
  clearSession: () => clearSessionMock(),
}));

vi.mock("@/interfaces", () => ({
  getServices: () => ({
    auth: {
      signIn: async () => undefined,
      signOut: () => mockServicesSignOut(),
      getCurrentUser: async () => null,
    },
  }),
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      signOut: () => realSignOutMock(),
    },
  }),
}));

import { GET, POST } from "./route";

function makeRequest(): NextRequest {
  return new NextRequest(new URL("http://localhost/logout"));
}

describe("logout route", () => {
  beforeEach(() => {
    delete process.env.USE_MOCKS;
    clearSessionMock.mockClear();
    mockServicesSignOut.mockReset();
    mockServicesSignOut.mockResolvedValue(undefined);
    realSignOutMock.mockReset();
    realSignOutMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  describe("mock mode (USE_MOCKS unset)", () => {
    it("GET calls getServices().auth.signOut() and clearSession() and redirects to /login with 303", async () => {
      const resp = await GET(makeRequest());
      expect(mockServicesSignOut).toHaveBeenCalledTimes(1);
      expect(clearSessionMock).toHaveBeenCalledTimes(1);
      expect(realSignOutMock).not.toHaveBeenCalled();
      expect(resp.status).toBe(303);
      expect(resp.headers.get("location")).toMatch(/\/login$/);
    });

    it("POST behaves the same as GET", async () => {
      const resp = await POST(makeRequest());
      expect(mockServicesSignOut).toHaveBeenCalledTimes(1);
      expect(clearSessionMock).toHaveBeenCalledTimes(1);
      expect(resp.status).toBe(303);
    });

    it("still calls clearSession() when signOut throws (best-effort finally)", async () => {
      mockServicesSignOut.mockRejectedValueOnce(new Error("auth glitch"));
      await expect(GET(makeRequest())).rejects.toThrow(/auth glitch/);
      expect(clearSessionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("real mode (USE_MOCKS=false)", () => {
    beforeEach(() => {
      process.env.USE_MOCKS = "false";
    });

    it("GET calls supabase.auth.signOut() and clearSession() and redirects", async () => {
      const resp = await GET(makeRequest());
      expect(realSignOutMock).toHaveBeenCalledTimes(1);
      expect(clearSessionMock).toHaveBeenCalledTimes(1);
      expect(mockServicesSignOut).not.toHaveBeenCalled();
      expect(resp.status).toBe(303);
      expect(resp.headers.get("location")).toMatch(/\/login$/);
    });

    it("still clears session and redirects when supabase.auth.signOut rejects", async () => {
      realSignOutMock.mockRejectedValueOnce(new Error("supabase 500"));
      const resp = await GET(makeRequest());
      expect(clearSessionMock).toHaveBeenCalledTimes(1);
      expect(resp.status).toBe(303);
    });
  });
});
