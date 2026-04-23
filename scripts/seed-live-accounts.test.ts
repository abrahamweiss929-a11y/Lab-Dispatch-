import { describe, it, expect, vi } from "vitest";
import { seedAccount } from "./seed-live-accounts";

function makeMockSb(
  existingUsers: Array<{ id: string; email: string }> = [],
  newUserId = "new-user-id",
) {
  const upsertFn = vi.fn().mockResolvedValue({ error: null });
  const fromFn = vi.fn().mockReturnValue({ upsert: upsertFn });

  const sb = {
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: existingUsers },
          error: null,
        }),
        createUser: vi.fn().mockResolvedValue({
          data: { user: { id: newUserId } },
          error: null,
        }),
      },
    },
    from: fromFn,
  } as unknown as ReturnType<typeof import("@/interfaces/supabase-client").getSupabaseAdminClient>;

  return { sb, fromFn, upsertFn };
}

describe("seedAccount — drivers row", () => {
  it("upserts a drivers row when role is driver", async () => {
    const { sb, fromFn, upsertFn } = makeMockSb([], "driver-uuid");

    await seedAccount(sb, {
      email: "driver@test",
      role: "driver",
      fullName: "Test Driver",
    });

    // Should call from("profiles") and from("drivers")
    const tableNames = fromFn.mock.calls.map((c: [string]) => c[0]);
    expect(tableNames).toContain("profiles");
    expect(tableNames).toContain("drivers");

    // The drivers upsert should carry profile_id and active=true
    const driversCallIdx = tableNames.lastIndexOf("drivers");
    const driversUpsertArg = upsertFn.mock.calls[driversCallIdx][0];
    expect(driversUpsertArg).toMatchObject({
      profile_id: "driver-uuid",
      active: true,
    });
  });

  it("does NOT upsert a drivers row when role is admin", async () => {
    const { sb, fromFn } = makeMockSb([], "admin-uuid");

    await seedAccount(sb, {
      email: "admin@test",
      role: "admin",
      fullName: "Test Admin",
    });

    const tableNames = fromFn.mock.calls.map((c: [string]) => c[0]);
    expect(tableNames).not.toContain("drivers");
  });

  it("does NOT upsert a drivers row when role is dispatcher", async () => {
    const { sb, fromFn } = makeMockSb([], "dispatcher-uuid");

    await seedAccount(sb, {
      email: "dispatcher@test",
      role: "dispatcher",
      fullName: "Test Dispatcher",
    });

    const tableNames = fromFn.mock.calls.map((c: [string]) => c[0]);
    expect(tableNames).not.toContain("drivers");
  });

  it("skips createUser when user already exists and still upserts drivers row", async () => {
    const { sb, fromFn } = makeMockSb(
      [{ id: "existing-driver-id", email: "driver@test" }],
    );

    await seedAccount(sb, {
      email: "driver@test",
      role: "driver",
      fullName: "Test Driver",
    });

    expect(sb.auth.admin.createUser).not.toHaveBeenCalled();
    const tableNames = fromFn.mock.calls.map((c: [string]) => c[0]);
    expect(tableNames).toContain("drivers");
  });
});
