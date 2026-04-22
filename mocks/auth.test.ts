import { describe, it, expect, beforeEach } from "vitest";
import { authMock, resetAuthMock } from "./auth";

describe("authMock", () => {
  beforeEach(() => {
    resetAuthMock();
  });

  it("signs in, reflects via getCurrentUser, and signs out", async () => {
    const session = await authMock.signIn({
      email: "driver@test",
      password: "test1234",
    });
    expect(session).toEqual({ userId: "user-driver", role: "driver" });

    const current = await authMock.getCurrentUser();
    expect(current).toEqual(session);

    await authMock.signOut();
    expect(await authMock.getCurrentUser()).toBeNull();
  });

  it("signs in for each seeded account", async () => {
    const dispatcher = await authMock.signIn({
      email: "dispatcher@test",
      password: "test1234",
    });
    expect(dispatcher.role).toBe("dispatcher");

    const admin = await authMock.signIn({
      email: "admin@test",
      password: "test1234",
    });
    expect(admin.role).toBe("admin");
  });

  it("rejects wrong password", async () => {
    await expect(
      authMock.signIn({ email: "driver@test", password: "wrong" }),
    ).rejects.toThrow(/invalid credentials/);
  });

  it("rejects unknown email", async () => {
    await expect(
      authMock.signIn({ email: "ghost@test", password: "test1234" }),
    ).rejects.toThrow(/invalid credentials/);
  });

  it("email lookup is case-insensitive", async () => {
    const session = await authMock.signIn({
      email: "Driver@Test",
      password: "test1234",
    });
    expect(session.userId).toBe("user-driver");
  });

  it("signOut is idempotent", async () => {
    await authMock.signOut();
    await authMock.signOut();
    expect(await authMock.getCurrentUser()).toBeNull();
  });
});
