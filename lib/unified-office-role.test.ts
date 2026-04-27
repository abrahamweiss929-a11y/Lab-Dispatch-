import { describe, it, expect } from "vitest";
import { evaluateAccess, isOfficeRole } from "@/lib/auth-rules";
import { authMock, resetAuthMock } from "@/mocks/auth";

/**
 * Acceptance tests for the 2026-04-27 unification: every back-office user
 * now has full access to both /admin/* and /dispatcher/* trees.
 *
 * Three scenarios:
 *   1. Legacy admin@test and dispatcher@test logins still work.
 *   2. An 'office' user can reach every back-office page.
 *   3. A 'driver' user cannot reach any back-office page.
 *
 * The mock auth (post-migration) seeds both legacy emails to role
 * 'office', matching what the production migration does to existing
 * profile rows.
 */

describe("unified office role — legacy logins (mock seeds office)", () => {
  it("admin@test signs in and resolves to office role", async () => {
    resetAuthMock();
    const session = await authMock.signIn({
      email: "admin@test",
      password: "test1234",
    });
    expect(session.role).toBe("office");
    expect(session.userId).toBe("user-admin");
  });

  it("dispatcher@test signs in and resolves to office role", async () => {
    resetAuthMock();
    const session = await authMock.signIn({
      email: "dispatcher@test",
      password: "test1234",
    });
    expect(session.role).toBe("office");
    expect(session.userId).toBe("user-dispatcher");
  });

  it("driver@test signs in unchanged", async () => {
    resetAuthMock();
    const session = await authMock.signIn({
      email: "driver@test",
      password: "test1234",
    });
    expect(session.role).toBe("driver");
  });
});

describe("unified office role — backward compat for unmigrated rows", () => {
  // If any profile row is still on legacy 'admin' or 'dispatcher' (e.g.
  // the production migration hasn't been applied yet, or a Supabase
  // bypass-RLS write inserted the legacy value), routing must keep
  // working as if it were 'office'.
  it("isOfficeRole admits all three back-office values", () => {
    expect(isOfficeRole("office")).toBe(true);
    expect(isOfficeRole("admin")).toBe(true);
    expect(isOfficeRole("dispatcher")).toBe(true);
  });

  it("isOfficeRole rejects driver and null", () => {
    expect(isOfficeRole("driver")).toBe(false);
    expect(isOfficeRole(null)).toBe(false);
  });
});

describe("unified office role — office can reach every back-office page", () => {
  // The unified sidebar exposes 10 destinations. An office user must be
  // able to reach every single one. /admin/* and /dispatcher/* are URL
  // aliases for the same surface.
  const officePages = [
    "/dispatcher", // Dashboard
    "/dispatcher/requests",
    "/dispatcher/routes",
    "/dispatcher/routes/r1",
    "/dispatcher/map",
    "/dispatcher/messages",
    "/dispatcher/messages/m1",
    "/admin",
    "/admin/drivers",
    "/admin/doctors",
    "/admin/offices",
    "/admin/payroll",
    "/admin/users",
  ] as const;

  for (const path of officePages) {
    it(`office role allowed at ${path}`, () => {
      expect(evaluateAccess({ pathname: path, role: "office" })).toEqual({
        action: "allow",
      });
    });
  }
});

describe("unified office role — driver cannot reach any back-office page", () => {
  const officePages = [
    "/dispatcher",
    "/dispatcher/requests",
    "/dispatcher/routes",
    "/dispatcher/map",
    "/dispatcher/messages",
    "/admin",
    "/admin/drivers",
    "/admin/doctors",
    "/admin/offices",
    "/admin/payroll",
    "/admin/users",
  ] as const;

  for (const path of officePages) {
    it(`driver role redirected away from ${path}`, () => {
      expect(evaluateAccess({ pathname: path, role: "driver" })).toEqual({
        action: "redirect",
        to: "/driver",
      });
    });
  }

  it("driver retains access to its own /driver tree", () => {
    expect(evaluateAccess({ pathname: "/driver", role: "driver" })).toEqual({
      action: "allow",
    });
    expect(
      evaluateAccess({ pathname: "/driver/route", role: "driver" }),
    ).toEqual({ action: "allow" });
  });
});

describe("unified office role — anonymous traffic still gated", () => {
  // Unification didn't widen access for anonymous traffic.
  const protectedPages = [
    "/dispatcher",
    "/dispatcher/requests",
    "/admin",
    "/admin/users",
  ] as const;

  for (const path of protectedPages) {
    it(`null role redirected to login at ${path}`, () => {
      const result = evaluateAccess({ pathname: path, role: null });
      expect(result.action).toBe("redirect");
      if (result.action !== "redirect") return;
      expect(result.to).toMatch(/^\/login\?next=/);
    });
  }
});
