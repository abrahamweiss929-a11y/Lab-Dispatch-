import { describe, expect, it } from "vitest";
import {
  evaluateAccess,
  isPublicPath,
  landingPathFor,
  PROTECTED_TREES,
  PUBLIC_PATH_PREFIXES,
} from "@/lib/auth-rules";
import type { UserRole } from "@/lib/types";

const ALL_ROLES: readonly (UserRole | null)[] = [
  null,
  "driver",
  "dispatcher",
  "admin",
];

describe("PUBLIC_PATH_PREFIXES", () => {
  it("matches the documented list", () => {
    expect(PUBLIC_PATH_PREFIXES).toEqual([
      "/login",
      "/logout",
      "/pickup/",
      "/api/",
      "/_next/",
      "/favicon",
    ]);
  });
});

describe("PROTECTED_TREES", () => {
  it("maps each role to its root path", () => {
    expect(PROTECTED_TREES).toEqual({
      driver: "/driver",
      dispatcher: "/dispatcher",
      admin: "/admin",
    });
  });
});

describe("landingPathFor", () => {
  it("returns the role's root path", () => {
    expect(landingPathFor("driver")).toBe("/driver");
    expect(landingPathFor("dispatcher")).toBe("/dispatcher");
    expect(landingPathFor("admin")).toBe("/admin");
  });
});

describe("isPublicPath", () => {
  it("treats /login and /logout as public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/logout")).toBe(true);
  });

  it("treats /pickup/<token> and /api/* and /_next/* as public", () => {
    expect(isPublicPath("/pickup/abc-token")).toBe(true);
    expect(isPublicPath("/api/webhooks/twilio")).toBe(true);
    expect(isPublicPath("/_next/static/chunks/x.js")).toBe(true);
  });

  it("treats /favicon.ico as public", () => {
    expect(isPublicPath("/favicon.ico")).toBe(true);
  });

  it("does not treat / as public (root is handled separately)", () => {
    expect(isPublicPath("/")).toBe(false);
  });

  it("does not treat /pickup (without trailing slash) as public", () => {
    // Prefix is "/pickup/"; bare "/pickup" shouldn't match.
    expect(isPublicPath("/pickup")).toBe(false);
  });
});

describe("evaluateAccess — public paths", () => {
  const publicPaths = [
    "/",
    "/login",
    "/logout",
    "/pickup/foo-abc",
    "/api/webhooks/twilio",
    "/_next/static/chunks/x.js",
    "/favicon.ico",
  ];

  for (const pathname of publicPaths) {
    for (const role of ALL_ROLES) {
      it(`allows ${pathname} for role=${role ?? "null"}`, () => {
        expect(evaluateAccess({ pathname, role })).toEqual({ action: "allow" });
      });
    }
  }
});

describe("evaluateAccess — unauthenticated hits to protected trees", () => {
  const cases = [
    { pathname: "/driver", encoded: "%2Fdriver" },
    { pathname: "/dispatcher", encoded: "%2Fdispatcher" },
    { pathname: "/admin", encoded: "%2Fadmin" },
    { pathname: "/driver/route", encoded: "%2Fdriver%2Froute" },
    { pathname: "/admin/users", encoded: "%2Fadmin%2Fusers" },
  ];

  for (const { pathname, encoded } of cases) {
    it(`redirects ${pathname} to /login?next=${encoded}`, () => {
      expect(evaluateAccess({ pathname, role: null })).toEqual({
        action: "redirect",
        to: `/login?next=${encoded}`,
      });
    });
  }
});

describe("evaluateAccess — driver role", () => {
  it("allows /driver and /driver/route", () => {
    expect(evaluateAccess({ pathname: "/driver", role: "driver" })).toEqual({
      action: "allow",
    });
    expect(
      evaluateAccess({ pathname: "/driver/route", role: "driver" }),
    ).toEqual({ action: "allow" });
  });

  it("redirects driver hitting /dispatcher or /admin/users to /driver", () => {
    expect(evaluateAccess({ pathname: "/dispatcher", role: "driver" })).toEqual(
      { action: "redirect", to: "/driver" },
    );
    expect(
      evaluateAccess({ pathname: "/admin/users", role: "driver" }),
    ).toEqual({ action: "redirect", to: "/driver" });
  });
});

describe("evaluateAccess — dispatcher role", () => {
  it("allows /dispatcher", () => {
    expect(
      evaluateAccess({ pathname: "/dispatcher", role: "dispatcher" }),
    ).toEqual({ action: "allow" });
    expect(
      evaluateAccess({ pathname: "/dispatcher/queue", role: "dispatcher" }),
    ).toEqual({ action: "allow" });
  });

  it("redirects dispatcher hitting /driver or /admin to /dispatcher", () => {
    expect(
      evaluateAccess({ pathname: "/driver", role: "dispatcher" }),
    ).toEqual({ action: "redirect", to: "/dispatcher" });
    expect(evaluateAccess({ pathname: "/admin", role: "dispatcher" })).toEqual({
      action: "redirect",
      to: "/dispatcher",
    });
  });
});

describe("evaluateAccess — admin role", () => {
  it("allows all three trees", () => {
    expect(evaluateAccess({ pathname: "/driver", role: "admin" })).toEqual({
      action: "allow",
    });
    expect(evaluateAccess({ pathname: "/dispatcher", role: "admin" })).toEqual({
      action: "allow",
    });
    expect(evaluateAccess({ pathname: "/admin", role: "admin" })).toEqual({
      action: "allow",
    });
    expect(
      evaluateAccess({ pathname: "/admin/users", role: "admin" }),
    ).toEqual({ action: "allow" });
  });
});

describe("evaluateAccess — prefix-collision edge cases", () => {
  it("treats /driverhack as outside the /driver tree (default-allow)", () => {
    // No slash boundary — should NOT be treated as a protected /driver path.
    expect(evaluateAccess({ pathname: "/driverhack", role: null })).toEqual({
      action: "allow",
    });
    expect(
      evaluateAccess({ pathname: "/driverhack", role: "dispatcher" }),
    ).toEqual({ action: "allow" });
  });

  it("treats /blog as default-allow for null role", () => {
    expect(evaluateAccess({ pathname: "/blog", role: null })).toEqual({
      action: "allow",
    });
  });

  it("treats nested paths under protected trees correctly", () => {
    // Exact slash boundary is enforced.
    expect(
      evaluateAccess({ pathname: "/admin/", role: null }),
    ).toEqual({
      action: "redirect",
      to: "/login?next=%2Fadmin%2F",
    });
  });
});
