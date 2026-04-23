import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authGetUserImpl = vi.fn();
const createServerClientSpy = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    url: string,
    key: string,
    opts: { cookies: { getAll: () => unknown; setAll: (list: unknown) => void } },
  ) => {
    createServerClientSpy(url, key, opts);
    return {
      auth: {
        getUser: () => authGetUserImpl(),
      },
    };
  },
}));

import {
  readSessionFromRequest,
  updateSession,
} from "@/lib/supabase-middleware";

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const body = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const signature = "signature-not-verified";
  return `${header}.${body}.${signature}`;
}

function makeRequest(cookies: Record<string, string>): NextRequest {
  const req = new NextRequest(new URL("http://localhost/driver"));
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

describe("updateSession", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    authGetUserImpl.mockReset();
    authGetUserImpl.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    createServerClientSpy.mockClear();
  });

  it("constructs a server client and calls auth.getUser exactly once", async () => {
    const req = makeRequest({});
    await updateSession(req);
    expect(createServerClientSpy).toHaveBeenCalledTimes(1);
    expect(authGetUserImpl).toHaveBeenCalledTimes(1);
  });

  it("wires cookie adapters that read from request.cookies", async () => {
    const req = makeRequest({ "sb-test-auth-token": "abc" });
    await updateSession(req);
    const opts = createServerClientSpy.mock.calls[0]?.[2] as {
      cookies: { getAll: () => { name: string; value: string }[] };
    };
    const readBack = opts.cookies.getAll();
    expect(readBack.some((c) => c.name === "sb-test-auth-token")).toBe(true);
  });

  it("returns a pass-through response when env vars are unset", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const req = makeRequest({});
    const resp = await updateSession(req);
    expect(resp).toBeDefined();
    expect(createServerClientSpy).not.toHaveBeenCalled();
  });
});

describe("readSessionFromRequest", () => {
  beforeEach(() => {
    createServerClientSpy.mockClear();
  });

  it("returns null when ld_role is missing", async () => {
    const req = makeRequest({
      "sb-test-auth-token": buildJwt({ sub: "user-1" }),
    });
    expect(await readSessionFromRequest(req)).toBeNull();
  });

  it("returns null when the Supabase access token is missing", async () => {
    const req = makeRequest({ ld_role: "driver" });
    expect(await readSessionFromRequest(req)).toBeNull();
  });

  it("returns null when ld_role holds an unknown role", async () => {
    const req = makeRequest({
      ld_role: "hacker",
      "sb-test-auth-token": buildJwt({ sub: "user-1" }),
    });
    expect(await readSessionFromRequest(req)).toBeNull();
  });

  it("returns { userId, role } on the happy path (bare JWT cookie)", async () => {
    const req = makeRequest({
      ld_role: "driver",
      "sb-test-auth-token": buildJwt({ sub: "user-42" }),
    });
    expect(await readSessionFromRequest(req)).toEqual({
      userId: "user-42",
      role: "driver",
    });
  });

  it("returns { userId, role } when the cookie is JSON-encoded [access, refresh]", async () => {
    const jwt = buildJwt({ sub: "user-55" });
    const jsonEncoded = JSON.stringify([jwt, "refresh-token"]);
    const req = makeRequest({
      ld_role: "admin",
      "sb-test-auth-token": jsonEncoded,
    });
    expect(await readSessionFromRequest(req)).toEqual({
      userId: "user-55",
      role: "admin",
    });
  });

  it("returns { userId, role } when the cookie is JSON object shape", async () => {
    const jwt = buildJwt({ sub: "user-77" });
    const jsonEncoded = JSON.stringify({ access_token: jwt });
    const req = makeRequest({
      ld_role: "dispatcher",
      "sb-test-auth-token": jsonEncoded,
    });
    expect(await readSessionFromRequest(req)).toEqual({
      userId: "user-77",
      role: "dispatcher",
    });
  });

  it("returns null when the JWT payload is malformed (non-JSON)", async () => {
    // A JWT-shaped string whose middle segment is not valid JSON after
    // base64-url decode.
    const malformed = "abc.not-base64-json.signature";
    const req = makeRequest({
      ld_role: "driver",
      "sb-test-auth-token": malformed,
    });
    expect(await readSessionFromRequest(req)).toBeNull();
  });

  it("returns null when the JWT has no sub claim", async () => {
    const req = makeRequest({
      ld_role: "driver",
      "sb-test-auth-token": buildJwt({ role: "authenticated" }),
    });
    expect(await readSessionFromRequest(req)).toBeNull();
  });

  it("returns null when the JWT sub claim is an empty string", async () => {
    const req = makeRequest({
      ld_role: "driver",
      "sb-test-auth-token": buildJwt({ sub: "" }),
    });
    expect(await readSessionFromRequest(req)).toBeNull();
  });

  it("reassembles chunked sb-*-auth-token.0 / .1 cookies", async () => {
    const jwt = buildJwt({ sub: "user-chunked" });
    // Split the JSON-encoded form across two chunks as @supabase/ssr does
    // for large cookies.
    const full = JSON.stringify([jwt, "refresh"]);
    const mid = Math.floor(full.length / 2);
    const req = makeRequest({
      ld_role: "driver",
      "sb-proj-auth-token.0": full.slice(0, mid),
      "sb-proj-auth-token.1": full.slice(mid),
    });
    expect(await readSessionFromRequest(req)).toEqual({
      userId: "user-chunked",
      role: "driver",
    });
  });

  it("decodes the base64- prefixed cookie shape used by @supabase/ssr v0.5+", async () => {
    // This is the actual shape in production: the cookie value is
    // "base64-<b64encoded JSON session>". The middleware must base64-decode
    // before JSON.parse — a past bug treated the b64 string as JSON
    // directly and returned null, causing an infinite /admin → /login loop.
    const jwt = buildJwt({ sub: "user-b64" });
    const session = {
      access_token: jwt,
      refresh_token: "refresh",
      expires_at: 9999999999,
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "user-b64" },
    };
    const b64 = Buffer.from(JSON.stringify(session)).toString("base64");
    const req = makeRequest({
      ld_role: "admin",
      "sb-usaaakfdmqydflsudknk-auth-token": `base64-${b64}`,
    });
    expect(await readSessionFromRequest(req)).toEqual({
      userId: "user-b64",
      role: "admin",
    });
  });

  it("handles chunked + base64- prefixed cookies together", async () => {
    const jwt = buildJwt({ sub: "user-b64-chunked" });
    const session = {
      access_token: jwt,
      refresh_token: "refresh",
      expires_at: 9999999999,
      expires_in: 3600,
      token_type: "bearer",
    };
    const b64 = Buffer.from(JSON.stringify(session)).toString("base64");
    const full = `base64-${b64}`;
    const mid = Math.floor(full.length / 2);
    const req = makeRequest({
      ld_role: "dispatcher",
      // Intentionally set .1 first to prove the middleware sorts by name
      // rather than trusting the cookie header order.
      "sb-proj-auth-token.1": full.slice(mid),
      "sb-proj-auth-token.0": full.slice(0, mid),
    });
    expect(await readSessionFromRequest(req)).toEqual({
      userId: "user-b64-chunked",
      role: "dispatcher",
    });
  });
});
