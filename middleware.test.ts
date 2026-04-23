import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Controllable real-mode helpers.
const updateSessionMock = vi.fn();
const readSessionFromRequestMock = vi.fn();

vi.mock("@/lib/supabase-middleware", () => ({
  updateSession: (req: NextRequest) => updateSessionMock(req),
  readSessionFromRequest: (req: NextRequest) => readSessionFromRequestMock(req),
}));

import { middleware } from "./middleware";
import { SESSION_COOKIE, encodeSession } from "@/lib/session-codec";

function makeRequest(
  path: string,
  cookies: Record<string, string> = {},
): NextRequest {
  const req = new NextRequest(new URL(`http://localhost${path}`));
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

describe("middleware — mock mode (USE_MOCKS unset)", () => {
  beforeEach(() => {
    delete process.env.USE_MOCKS;
    updateSessionMock.mockReset();
    readSessionFromRequestMock.mockReset();
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  it("redirects unauthenticated driver-area requests to /login?next=...", async () => {
    const resp = await middleware(makeRequest("/driver"));
    expect(resp.status).toBe(307);
    expect(resp.headers.get("location")).toMatch(
      /\/login\?next=%2Fdriver/,
    );
  });

  it("allows authenticated driver with ld_session cookie to /driver", async () => {
    const ld = encodeSession({ userId: "u", role: "driver" });
    const resp = await middleware(
      makeRequest("/driver", { [SESSION_COOKIE]: ld }),
    );
    // NextResponse.next() has status 200 by default.
    expect(resp.status).toBe(200);
  });

  it("redirects a driver trying to visit /admin to /driver", async () => {
    const ld = encodeSession({ userId: "u", role: "driver" });
    const resp = await middleware(
      makeRequest("/admin", { [SESSION_COOKIE]: ld }),
    );
    expect(resp.status).toBe(307);
    expect(resp.headers.get("location")).toMatch(/\/driver$/);
  });

  it("allows public /login without a session", async () => {
    const resp = await middleware(makeRequest("/login"));
    expect(resp.status).toBe(200);
  });

  it("allows public /pickup/slug-token without a session", async () => {
    const resp = await middleware(makeRequest("/pickup/abc"));
    expect(resp.status).toBe(200);
  });

  it("does not invoke the real-mode helpers", async () => {
    await middleware(makeRequest("/driver"));
    expect(updateSessionMock).not.toHaveBeenCalled();
    expect(readSessionFromRequestMock).not.toHaveBeenCalled();
  });
});

describe("middleware — real mode (USE_MOCKS=false)", () => {
  beforeEach(() => {
    process.env.USE_MOCKS = "false";
    updateSessionMock.mockReset();
    readSessionFromRequestMock.mockReset();
  });

  afterEach(() => {
    delete process.env.USE_MOCKS;
  });

  it("refreshes cookies and allows authenticated driver to /driver", async () => {
    const refreshed = NextResponse.next();
    updateSessionMock.mockResolvedValue(refreshed);
    readSessionFromRequestMock.mockResolvedValue({
      userId: "u",
      role: "driver",
    });

    const resp = await middleware(makeRequest("/driver"));
    expect(updateSessionMock).toHaveBeenCalledTimes(1);
    expect(readSessionFromRequestMock).toHaveBeenCalledTimes(1);
    expect(resp).toBe(refreshed);
  });

  it("redirects unauthenticated real-mode request to /login?next=...", async () => {
    updateSessionMock.mockResolvedValue(NextResponse.next());
    readSessionFromRequestMock.mockResolvedValue(null);

    const resp = await middleware(makeRequest("/admin"));
    expect(resp.status).toBe(307);
    expect(resp.headers.get("location")).toMatch(
      /\/login\?next=%2Fadmin/,
    );
  });

  it("redirects a driver trying to visit /admin to /driver in real mode too", async () => {
    updateSessionMock.mockResolvedValue(NextResponse.next());
    readSessionFromRequestMock.mockResolvedValue({
      userId: "u",
      role: "driver",
    });

    const resp = await middleware(makeRequest("/admin"));
    expect(resp.status).toBe(307);
    expect(resp.headers.get("location")).toMatch(/\/driver$/);
  });

  it("allows public /login without a session, but still refreshes cookies", async () => {
    updateSessionMock.mockResolvedValue(NextResponse.next());
    readSessionFromRequestMock.mockResolvedValue(null);

    const resp = await middleware(makeRequest("/login"));
    expect(resp.status).toBe(200);
    // Even on public pages, updateSession runs so the cookie refresh
    // lands on the browser.
    expect(updateSessionMock).toHaveBeenCalledTimes(1);
  });
});
