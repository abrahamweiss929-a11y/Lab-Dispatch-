import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeSession, encodeSession } from "@/lib/session-codec";

describe("session codec", () => {
  it("round-trips a valid session", () => {
    const value = { userId: "u1", role: "admin" as const };
    const encoded = encodeSession(value);
    expect(decodeSession(encoded)).toEqual(value);
  });

  it("round-trips each role", () => {
    for (const role of ["driver", "dispatcher", "admin"] as const) {
      const encoded = encodeSession({ userId: "x", role });
      expect(decodeSession(encoded)).toEqual({ userId: "x", role });
    }
  });

  it("returns null for undefined cookie", () => {
    expect(decodeSession(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(decodeSession("")).toBeNull();
  });

  it("returns null for non-base64 garbage", () => {
    // Characters that cannot form a valid base64 payload decoding to JSON.
    expect(decodeSession("!!!")).toBeNull();
  });

  it("returns null for base64 of non-JSON", () => {
    const raw = Buffer.from("hello", "utf8").toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null for base64 of JSON with empty object", () => {
    const raw = Buffer.from(JSON.stringify({}), "utf8").toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null when role is unknown", () => {
    const raw = Buffer.from(
      JSON.stringify({ userId: "u1", role: "hacker" }),
      "utf8",
    ).toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null when userId is numeric", () => {
    const raw = Buffer.from(
      JSON.stringify({ userId: 42, role: "admin" }),
      "utf8",
    ).toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null when userId is empty string", () => {
    const raw = Buffer.from(
      JSON.stringify({ userId: "", role: "admin" }),
      "utf8",
    ).toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null when role is missing", () => {
    const raw = Buffer.from(
      JSON.stringify({ userId: "u1" }),
      "utf8",
    ).toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });

  it("returns null when payload is JSON null", () => {
    const raw = Buffer.from(JSON.stringify(null), "utf8").toString("base64");
    expect(decodeSession(raw)).toBeNull();
  });
});

// -----------------------------------------------------------------------
// Dual-mode async getSession / setSession / clearSession tests.
//
// These exercise the cookie-handling branches in `lib/session.ts`:
//   - Mock mode (USE_MOCKS=true or unset): reads/writes `ld_session`.
//   - Real mode (USE_MOCKS=false): reads via `getUserFromSession()` from
//     `@/lib/supabase-server`; writes only the `ld_role` companion cookie.
//
// We mock `next/headers`, `@supabase/ssr`, `@/interfaces/supabase-client`,
// and `@/lib/supabase-server` — never let any real HTTP fire.
// -----------------------------------------------------------------------

const cookieStore = new Map<string, string>();
const cookieSetSpy = vi.fn();
const cookieDeleteSpy = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (
      ...args: unknown[]
    ) => {
      if (typeof args[0] === "string") {
        const name = args[0];
        const value = String(args[1] ?? "");
        cookieStore.set(name, value);
        cookieSetSpy(name, value, args[2]);
      } else {
        const entry = args[0] as { name: string; value: string };
        cookieStore.set(entry.name, entry.value);
        cookieSetSpy(entry.name, entry.value, entry);
      }
    },
    delete: (name: string) => {
      cookieStore.delete(name);
      cookieDeleteSpy(name);
    },
    getAll: () =>
      Array.from(cookieStore.entries()).map(([name, value]) => ({
        name,
        value,
      })),
  }),
}));

const getUserFromSessionMock = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  getUserFromSession: () => getUserFromSessionMock(),
  createSupabaseServerClient: vi.fn(),
}));

describe("getSession / setSession / clearSession — dual mode", () => {
  beforeEach(() => {
    cookieStore.clear();
    cookieSetSpy.mockClear();
    cookieDeleteSpy.mockClear();
    getUserFromSessionMock.mockReset();
    delete process.env.USE_MOCKS;
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  describe("mock mode (USE_MOCKS unset)", () => {
    it("getSession reads the ld_session cookie", async () => {
      const { getSession } = await import("@/lib/session");
      const raw = encodeSession({ userId: "u1", role: "driver" });
      cookieStore.set("ld_session", raw);
      const session = await getSession();
      expect(session).toEqual({ userId: "u1", role: "driver" });
    });

    it("getSession returns null when ld_session is absent", async () => {
      const { getSession } = await import("@/lib/session");
      const session = await getSession();
      expect(session).toBeNull();
    });

    it("setSession writes ld_session with httpOnly + sameSite=lax + path=/", async () => {
      const { setSession } = await import("@/lib/session");
      await setSession("u1", "dispatcher");
      const raw = cookieStore.get("ld_session");
      expect(raw).toBeDefined();
      expect(decodeSession(raw)).toEqual({ userId: "u1", role: "dispatcher" });
      expect(cookieSetSpy).toHaveBeenCalledTimes(1);
      const options = cookieSetSpy.mock.calls[0]?.[2];
      expect(options).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    });

    it("clearSession deletes ld_session", async () => {
      const { clearSession } = await import("@/lib/session");
      cookieStore.set("ld_session", "anything");
      await clearSession();
      expect(cookieStore.has("ld_session")).toBe(false);
      expect(cookieDeleteSpy).toHaveBeenCalledWith("ld_session");
    });
  });

  describe("mock mode (USE_MOCKS='true' explicit)", () => {
    beforeEach(() => {
      process.env.USE_MOCKS = "true";
    });
    it("getSession still reads ld_session", async () => {
      const { getSession } = await import("@/lib/session");
      cookieStore.set(
        "ld_session",
        encodeSession({ userId: "u2", role: "admin" }),
      );
      expect(await getSession()).toEqual({ userId: "u2", role: "admin" });
    });
  });

  describe("real mode (USE_MOCKS='false')", () => {
    beforeEach(() => {
      process.env.USE_MOCKS = "false";
    });

    it("getSession delegates to getUserFromSession", async () => {
      getUserFromSessionMock.mockResolvedValue({
        userId: "auth-1",
        role: "driver",
      });
      const { getSession } = await import("@/lib/session");
      const session = await getSession();
      expect(session).toEqual({ userId: "auth-1", role: "driver" });
      expect(getUserFromSessionMock).toHaveBeenCalledTimes(1);
    });

    it("getSession returns null when getUserFromSession returns null", async () => {
      getUserFromSessionMock.mockResolvedValue(null);
      const { getSession } = await import("@/lib/session");
      expect(await getSession()).toBeNull();
    });

    it("setSession writes ONLY the ld_role cookie (not ld_session)", async () => {
      const { setSession } = await import("@/lib/session");
      await setSession("auth-1", "dispatcher");
      expect(cookieStore.get("ld_role")).toBe("dispatcher");
      expect(cookieStore.has("ld_session")).toBe(false);
      const options = cookieSetSpy.mock.calls[0]?.[2];
      expect(options).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    });

    it("clearSession deletes ld_role (not ld_session)", async () => {
      const { clearSession } = await import("@/lib/session");
      cookieStore.set("ld_role", "admin");
      cookieStore.set("ld_session", "should-not-be-deleted");
      await clearSession();
      expect(cookieStore.has("ld_role")).toBe(false);
      expect(cookieStore.has("ld_session")).toBe(true);
      expect(cookieDeleteSpy).toHaveBeenCalledWith("ld_role");
    });
  });

  describe("invalid USE_MOCKS value", () => {
    it("getSession throws when USE_MOCKS is a random string", async () => {
      process.env.USE_MOCKS = "banana";
      const { getSession } = await import("@/lib/session");
      await expect(getSession()).rejects.toThrow(/USE_MOCKS/);
    });

    it("setSession throws when USE_MOCKS is a random string", async () => {
      process.env.USE_MOCKS = "nonsense";
      const { setSession } = await import("@/lib/session");
      await expect(setSession("u", "admin")).rejects.toThrow(/USE_MOCKS/);
    });

    it("clearSession throws when USE_MOCKS is a random string", async () => {
      process.env.USE_MOCKS = "oops";
      const { clearSession } = await import("@/lib/session");
      await expect(clearSession()).rejects.toThrow(/USE_MOCKS/);
    });
  });
});
