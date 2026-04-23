import { beforeEach, describe, expect, it, vi } from "vitest";

// Controllable `createServerClient` factory. Each test configures
// `authGetUserImpl` to shape the response of `supabase.auth.getUser()`.
const cookieGetAll = vi.fn<[], { name: string; value: string }[]>(() => []);
const cookieSet = vi.fn();
const authGetUserImpl = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => ({
    getAll: () => cookieGetAll(),
    get: () => undefined,
    set: (...args: unknown[]) => cookieSet(...args),
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, _opts: unknown) => ({
    auth: {
      getUser: () => authGetUserImpl(),
    },
  })),
}));

// Admin client stub used by `getUserFromSession` for the profile lookup.
const profileResponseQueue: Array<{
  data: unknown;
  error: unknown;
}> = [];
const fromSpy = vi.fn();
vi.mock("@/interfaces/supabase-client", () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      fromSpy(table);
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          const next = profileResponseQueue.shift() ?? {
            data: null,
            error: null,
          };
          return next;
        },
      };
    },
  }),
  __resetSupabaseAdminClient: vi.fn(),
}));

import {
  createSupabaseServerClient,
  getUserFromSession,
} from "@/lib/supabase-server";

describe("createSupabaseServerClient", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    authGetUserImpl.mockReset();
    profileResponseQueue.length = 0;
    fromSpy.mockClear();
    cookieGetAll.mockClear();
    cookieSet.mockClear();
  });

  it("throws NotConfiguredError with envVar NEXT_PUBLIC_SUPABASE_URL when URL is unset", () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    expect(() => createSupabaseServerClient()).toThrowError(
      expect.objectContaining({
        name: "NotConfiguredError",
        envVar: "NEXT_PUBLIC_SUPABASE_URL",
      }),
    );
  });

  it("throws NotConfiguredError with envVar NEXT_PUBLIC_SUPABASE_ANON_KEY when anon key is unset", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    expect(() => createSupabaseServerClient()).toThrowError(
      expect.objectContaining({
        name: "NotConfiguredError",
        envVar: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      }),
    );
  });

  it("constructs a client when both env vars are present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    expect(() => createSupabaseServerClient()).not.toThrow();
  });
});

describe("getUserFromSession", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    authGetUserImpl.mockReset();
    profileResponseQueue.length = 0;
    fromSpy.mockClear();
    cookieGetAll.mockClear();
    cookieSet.mockClear();
  });

  it("returns null when auth.getUser yields no user", async () => {
    authGetUserImpl.mockResolvedValue({
      data: { user: null },
      error: { message: "no user" },
    });
    const out = await getUserFromSession();
    expect(out).toBeNull();
  });

  it("returns { userId, role } when user and profile resolve", async () => {
    authGetUserImpl.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    profileResponseQueue.push({ data: { role: "dispatcher" }, error: null });
    const out = await getUserFromSession();
    expect(out).toEqual({ userId: "user-1", role: "dispatcher" });
    expect(fromSpy).toHaveBeenCalledWith("profiles");
  });

  it("returns null when the profile row is missing", async () => {
    authGetUserImpl.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    profileResponseQueue.push({ data: null, error: null });
    expect(await getUserFromSession()).toBeNull();
  });

  it("returns null when the profile role is an unknown value", async () => {
    authGetUserImpl.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    profileResponseQueue.push({ data: { role: "hacker" }, error: null });
    expect(await getUserFromSession()).toBeNull();
  });

  it("returns null when the profile query errors", async () => {
    authGetUserImpl.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    profileResponseQueue.push({
      data: null,
      error: { message: "db exploded" },
    });
    expect(await getUserFromSession()).toBeNull();
  });

  it("returns null when the user id is missing or non-string", async () => {
    authGetUserImpl.mockResolvedValue({
      data: { user: { id: "" } },
      error: null,
    });
    expect(await getUserFromSession()).toBeNull();
  });

  it("returns null when env vars are unset (graceful degradation)", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(await getUserFromSession()).toBeNull();
  });
});
