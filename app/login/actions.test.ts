import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSafeNext } from "@/lib/auth-rules";

describe("isSafeNext", () => {
  it("accepts a plain same-origin path", () => {
    expect(isSafeNext("/driver")).toBe(true);
  });

  it("accepts the root path", () => {
    expect(isSafeNext("/")).toBe(true);
  });

  it("rejects protocol-relative URLs (//evil.com)", () => {
    expect(isSafeNext("//evil.com")).toBe(false);
  });

  it("rejects /\\evil.com (browsers normalize backslash to forward-slash)", () => {
    expect(isSafeNext("/\\evil.com")).toBe(false);
  });

  it("rejects absolute URLs with a scheme", () => {
    expect(isSafeNext("http://evil.com")).toBe(false);
  });

  it("rejects paths containing a NUL byte", () => {
    expect(isSafeNext("/path\x00null")).toBe(false);
  });

  it("rejects paths containing a line-feed", () => {
    expect(isSafeNext("/path\nfoo")).toBe(false);
  });

  it("rejects paths containing a carriage-return", () => {
    expect(isSafeNext("/path\rfoo")).toBe(false);
  });

  it("rejects paths containing a backslash anywhere", () => {
    expect(isSafeNext("/path\\back")).toBe(false);
  });

  it("rejects javascript: pseudo-URLs", () => {
    expect(isSafeNext("javascript:alert(1)")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isSafeNext("")).toBe(false);
  });
});

// -----------------------------------------------------------------------
// signInAction — dual-mode coverage. Mocks `@supabase/ssr`,
// `@/interfaces/supabase-client`, `@/lib/session`, and the mock auth
// service. No real HTTP.
// -----------------------------------------------------------------------

const redirectMock = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

const setSessionMock = vi.fn(async (_userId: string, _role: string) => undefined);
vi.mock("@/lib/session", () => ({
  setSession: (userId: string, role: string) => setSessionMock(userId, role),
}));

// Real-mode Supabase server client.
const signInWithPasswordMock = vi.fn();
const realSignOutMock = vi.fn(async () => undefined);
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      signInWithPassword: (args: unknown) => signInWithPasswordMock(args),
      signOut: () => realSignOutMock(),
    },
  }),
}));

// Admin client profile lookup.
const profileResponseQueue: Array<{
  data: unknown;
  error: unknown;
}> = [];
vi.mock("@/interfaces/supabase-client", () => ({
  getSupabaseAdminClient: () => ({
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      async maybeSingle() {
        return (
          profileResponseQueue.shift() ?? { data: null, error: null }
        );
      },
    }),
  }),
  __resetSupabaseAdminClient: () => undefined,
}));

// Mock-mode auth service path.
const mockAuthSignIn = vi.fn();
vi.mock("@/interfaces", () => ({
  getServices: () => ({
    auth: {
      signIn: (params: unknown) => mockAuthSignIn(params),
      signOut: async () => undefined,
      getCurrentUser: async () => null,
    },
  }),
}));

import { signInAction } from "./actions";

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    form.set(key, value);
  }
  return form;
}

describe("signInAction — mock mode (USE_MOCKS unset)", () => {
  beforeEach(() => {
    delete process.env.USE_MOCKS;
    redirectMock.mockClear();
    setSessionMock.mockClear();
    mockAuthSignIn.mockReset();
    signInWithPasswordMock.mockReset();
    realSignOutMock.mockClear();
    profileResponseQueue.length = 0;
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  it("returns an error when email or password is empty", async () => {
    const state = await signInAction({ error: null }, fd({}));
    expect(state.error).toMatch(/Please enter/);
    expect(mockAuthSignIn).not.toHaveBeenCalled();
  });

  it("signs in via getServices().auth and sets the ld_session cookie", async () => {
    // Post-unification: every back-office role lands at /dispatcher.
    mockAuthSignIn.mockResolvedValue({ userId: "admin-1", role: "admin" });
    await expect(
      signInAction(
        { error: null },
        fd({ email: "admin@test", password: "test1234", next: "" }),
      ),
    ).rejects.toThrow(/REDIRECT:\/dispatcher/);
    expect(setSessionMock).toHaveBeenCalledWith("admin-1", "admin");
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it("returns a generic error when the mock auth rejects", async () => {
    mockAuthSignIn.mockRejectedValue(new Error("bad password"));
    const state = await signInAction(
      { error: null },
      fd({ email: "admin@test", password: "wrong", next: "" }),
    );
    expect(state.error).toBe("Invalid email or password.");
    expect(setSessionMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("honors a safe `next` param when access is allowed for the role", async () => {
    mockAuthSignIn.mockResolvedValue({ userId: "u", role: "admin" });
    await expect(
      signInAction(
        { error: null },
        fd({ email: "a@b", password: "p", next: "/admin/drivers" }),
      ),
    ).rejects.toThrow(/REDIRECT:\/admin\/drivers/);
  });

  it("falls back to the role's landing when `next` is unsafe", async () => {
    mockAuthSignIn.mockResolvedValue({ userId: "u", role: "driver" });
    await expect(
      signInAction(
        { error: null },
        fd({ email: "a", password: "b", next: "//evil.com" }),
      ),
    ).rejects.toThrow(/REDIRECT:\/driver/);
  });
});

describe("signInAction — real mode (USE_MOCKS=false)", () => {
  beforeEach(() => {
    process.env.USE_MOCKS = "false";
    redirectMock.mockClear();
    setSessionMock.mockClear();
    mockAuthSignIn.mockReset();
    signInWithPasswordMock.mockReset();
    realSignOutMock.mockClear();
    profileResponseQueue.length = 0;
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  it("signs in, reads role, sets ld_role, redirects to landing", async () => {
    // Post-unification: every back-office role lands at /dispatcher.
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: "uuid-1" } },
      error: null,
    });
    profileResponseQueue.push({ data: { role: "admin" }, error: null });

    await expect(
      signInAction(
        { error: null },
        fd({ email: "admin@test", password: "test1234", next: "" }),
      ),
    ).rejects.toThrow(/REDIRECT:\/dispatcher/);

    expect(signInWithPasswordMock).toHaveBeenCalledTimes(1);
    expect(setSessionMock).toHaveBeenCalledWith("uuid-1", "admin");
    expect(realSignOutMock).not.toHaveBeenCalled();
    expect(mockAuthSignIn).not.toHaveBeenCalled();
  });

  it("returns generic error when signInWithPassword reports an error, and writes nothing", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: null,
      error: { message: "Invalid login credentials" },
    });
    const state = await signInAction(
      { error: null },
      fd({ email: "a@b", password: "bad", next: "" }),
    );
    expect(state.error).toBe("Invalid email or password.");
    expect(setSessionMock).not.toHaveBeenCalled();
    expect(realSignOutMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns generic error when data.user is missing", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    const state = await signInAction(
      { error: null },
      fd({ email: "a@b", password: "p", next: "" }),
    );
    expect(state.error).toBe("Invalid email or password.");
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it("signs out and returns error when the profile row is missing (half-authenticated)", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: "uuid-1" } },
      error: null,
    });
    profileResponseQueue.push({ data: null, error: null });
    const state = await signInAction(
      { error: null },
      fd({ email: "a@b", password: "p", next: "" }),
    );
    expect(state.error).toBe("Invalid email or password.");
    expect(realSignOutMock).toHaveBeenCalledTimes(1);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it("signs out and returns error when the profile role is unknown", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: "uuid-1" } },
      error: null,
    });
    profileResponseQueue.push({ data: { role: "hacker" }, error: null });
    const state = await signInAction(
      { error: null },
      fd({ email: "a@b", password: "p", next: "" }),
    );
    expect(state.error).toBe("Invalid email or password.");
    expect(realSignOutMock).toHaveBeenCalledTimes(1);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  // Regression test for the post-2026-04-27 unification production
  // bug: ALLOWED_ROLES in lib/session-codec.ts had ['driver','dispatcher',
  // 'admin'] but profiles.role had been migrated to 'office', so
  // signInAction was calling signOut() and surfacing
  // "Invalid email or password" for every back-office user.
  it("accepts the unified 'office' role: NO signOut, sets session, redirects to /dispatcher", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: "uuid-office-1" } },
      error: null,
    });
    profileResponseQueue.push({ data: { role: "office" }, error: null });

    await expect(
      signInAction(
        { error: null },
        fd({ email: "office@example.com", password: "test1234", next: "" }),
      ),
    ).rejects.toThrow(/REDIRECT:\/dispatcher/);

    expect(setSessionMock).toHaveBeenCalledWith("uuid-office-1", "office");
    expect(realSignOutMock).not.toHaveBeenCalled();
  });
});
