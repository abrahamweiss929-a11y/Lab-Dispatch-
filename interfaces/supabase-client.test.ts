import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ __mockClient: true })),
}));

// Retrieve the spy by importing the (mocked) module.
import * as supabaseJs from "@supabase/supabase-js";
const createClientMock = supabaseJs.createClient as unknown as ReturnType<
  typeof vi.fn
>;

describe("getSupabaseAdminClient()", () => {
  beforeEach(async () => {
    // Force a fresh module load so the `createClient` binding inside
    // `supabase-client.ts` is re-resolved against the mocked module.
    // Without this, vitest's shared setup file preloads the module
    // graph before this file's `vi.mock` registers, leaving the real
    // `createClient` baked in.
    vi.resetModules();
    const { __resetSupabaseAdminClient } = await import("./supabase-client");
    __resetSupabaseAdminClient();
    createClientMock.mockClear();
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    const { __resetSupabaseAdminClient } = await import("./supabase-client");
    __resetSupabaseAdminClient();
    vi.unstubAllEnvs();
  });

  it("throws NotConfiguredError with envVar='NEXT_PUBLIC_SUPABASE_URL' when URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "some-key");
    const { getSupabaseAdminClient } = await import("./supabase-client");
    try {
      getSupabaseAdminClient();
      throw new Error("expected NotConfiguredError");
    } catch (err) {
      expect((err as Error).name).toBe("NotConfiguredError");
      expect((err as { envVar: string }).envVar).toBe(
        "NEXT_PUBLIC_SUPABASE_URL",
      );
    }
  });

  it("throws NotConfiguredError with envVar='SUPABASE_SERVICE_ROLE_KEY' when URL is set but key is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { getSupabaseAdminClient } = await import("./supabase-client");
    try {
      getSupabaseAdminClient();
      throw new Error("expected NotConfiguredError");
    } catch (err) {
      expect((err as Error).name).toBe("NotConfiguredError");
      expect((err as { envVar: string }).envVar).toBe(
        "SUPABASE_SERVICE_ROLE_KEY",
      );
    }
  });

  it("returns the same memoized client on repeated calls when both env vars are set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const mod = await import("./supabase-client");
    const before = createClientMock.mock.calls.length;
    const a = mod.getSupabaseAdminClient();
    const b = mod.getSupabaseAdminClient();
    expect(a).toBe(b);
    // createClient only called once (the second call hits the memoized instance).
    expect(createClientMock.mock.calls.length - before).toBe(1);
    expect(a).toMatchObject({ __mockClient: true });
  });

  it("does not include the service-role key value in the thrown error message", async () => {
    const SECRET = "super-secret-service-role-value-DO-NOT-LEAK";
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { getSupabaseAdminClient } = await import("./supabase-client");
    try {
      getSupabaseAdminClient();
      throw new Error("expected NotConfiguredError");
    } catch (err) {
      expect((err as Error).name).toBe("NotConfiguredError");
      const message = (err as Error).message;
      expect(message).not.toContain(SECRET);
      // Never embeds the env-var VALUE (only the variable NAME).
      expect(message).toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });

  it("does not include the URL value in the thrown error message when URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { getSupabaseAdminClient } = await import("./supabase-client");
    try {
      getSupabaseAdminClient();
      throw new Error("expected NotConfiguredError");
    } catch (err) {
      expect((err as Error).name).toBe("NotConfiguredError");
      const message = (err as Error).message;
      // No https:// leaking even if someone had pre-filled a partial URL.
      expect(message).not.toMatch(/https?:\/\//);
      expect(message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    }
  });
});
