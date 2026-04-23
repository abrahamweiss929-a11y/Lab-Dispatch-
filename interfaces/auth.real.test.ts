import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeFakeSupabase, type FakeSupabase } from "@/tests/helpers/fake-supabase";
import type { UserRole } from "@/lib/types";

// `vi.mock` is hoisted to the top of the file before `import` runs.
// The factory can only reference modules or `vi.hoisted` values —
// referencing outer file locals would hit the TDZ. We stash the holder
// on `vi.hoisted` so the factory closes over it safely.
const hoisted = vi.hoisted(() => {
  return {
    holder: { current: null as unknown as FakeSupabase | null },
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => hoisted.holder.current),
}));

import type { AuthService } from "./auth";

let fakeClient: FakeSupabase;
let authService: AuthService;

describe("createRealAuthService() — per-method coverage against fake Supabase", () => {
  beforeEach(async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    // Force a fresh module load so the `createClient` binding inside
    // `supabase-client.ts` re-resolves against the mocked module each
    // test.
    vi.resetModules();
    const clientMod = await import("./supabase-client");
    clientMod.__resetSupabaseAdminClient();
    fakeClient = makeFakeSupabase();
    hoisted.holder.current = fakeClient;
    const realMod = await import("./auth.real");
    authService = realMod.createRealAuthService();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const clientMod = await import("./supabase-client");
    clientMod.__resetSupabaseAdminClient();
  });

  // ---- signIn happy path ---------------------------------------------

  describe("signIn — happy path across all three roles", () => {
    const roles: UserRole[] = ["driver", "dispatcher", "admin"];
    it.each(roles)("returns { userId, role } for role=%s", async (role) => {
      fakeClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: { id: `u-${role}` }, session: null },
        error: null,
      });
      fakeClient.__enqueue("profiles", "select", {
        data: { role, full_name: "Test Person" },
        error: null,
      });
      const session = await authService.signIn({
        email: `${role}@test`,
        password: "test1234",
      });
      expect(session).toEqual({ userId: `u-${role}`, role });
      // Confirms the adapter called supabase auth once with the supplied
      // credentials — no mangling.
      expect(fakeClient.auth.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(fakeClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: `${role}@test`,
        password: "test1234",
      });
    });
  });

  // ---- signIn failure modes ------------------------------------------

  describe("signIn — every failure mode throws 'invalid credentials'", () => {
    it("throws on supabase auth error (wrong password)", async () => {
      fakeClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: "Invalid login credentials" },
      });
      await expect(
        authService.signIn({ email: "x@test", password: "wrong" }),
      ).rejects.toThrow("invalid credentials");
      // Profile must NEVER be queried on an auth failure — otherwise a
      // timing attack could reveal whether an email exists in the DB.
      expect(
        fakeClient.__calls().filter((c) => c.table === "profiles"),
      ).toHaveLength(0);
    });

    it("throws on null user with no explicit error (defensive)", async () => {
      fakeClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: null,
      });
      await expect(
        authService.signIn({ email: "x@test", password: "wrong" }),
      ).rejects.toThrow("invalid credentials");
      expect(
        fakeClient.__calls().filter((c) => c.table === "profiles"),
      ).toHaveLength(0);
    });

    it("throws when the profile row is missing", async () => {
      fakeClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: { id: "u-orphan" }, session: null },
        error: null,
      });
      fakeClient.__enqueue("profiles", "select", {
        data: null,
        error: null,
      });
      await expect(
        authService.signIn({ email: "orphan@test", password: "test1234" }),
      ).rejects.toThrow("invalid credentials");
    });

    it("throws when the profile row has an unknown role (defensive enum guard)", async () => {
      fakeClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: { id: "u1" }, session: null },
        error: null,
      });
      fakeClient.__enqueue("profiles", "select", {
        data: { role: "unknown_role", full_name: "X" },
        error: null,
      });
      await expect(
        authService.signIn({ email: "x@test", password: "test1234" }),
      ).rejects.toThrow("invalid credentials");
    });

    it("throws on profile-read DB error without leaking DB details", async () => {
      fakeClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: { id: "u1" }, session: null },
        error: null,
      });
      fakeClient.__enqueue("profiles", "select", {
        data: null,
        error: { code: "PGRST123", message: "some internal detail" },
      });
      const err = await authService
        .signIn({ email: "x@test", password: "test1234" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("invalid credentials");
      // Defense-in-depth: never leak internal PostgREST codes / messages.
      expect((err as Error).message).not.toContain("PGRST123");
      expect((err as Error).message).not.toContain("some internal detail");
    });
  });

  // ---- signOut --------------------------------------------------------

  describe("signOut", () => {
    it("calls supabase auth.signOut exactly once", async () => {
      await authService.signOut();
      expect(fakeClient.auth.signOut).toHaveBeenCalledTimes(1);
      expect(fakeClient.auth.signOut).toHaveBeenCalledWith();
    });

    it("does not throw when the underlying signOut rejects", async () => {
      fakeClient.auth.signOut.mockRejectedValueOnce(new Error("network down"));
      await expect(authService.signOut()).resolves.toBeUndefined();
    });
  });

  // ---- getCurrentUser -------------------------------------------------

  describe("getCurrentUser", () => {
    it("throws a scoped error pointing at STEP 4", async () => {
      await expect(authService.getCurrentUser()).rejects.toThrow(/STEP 4/);
    });
  });
});
