import { describe, expect, it, vi, beforeEach } from "vitest";

const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
const requireAdminSessionMock = vi.fn(() => ({
  userId: "admin-test",
  role: "admin" as const,
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

vi.mock("@/lib/require-admin", () => ({
  requireAdminSession: () => requireAdminSessionMock(),
}));

import {
  createDriverAction,
  deactivateDriverAction,
  updateDriverAction,
} from "./actions";
import { INITIAL_ADMIN_FORM_STATE } from "@/lib/admin-form";
import { storageMock, resetStorageMock } from "@/mocks/storage";

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    form.set(key, value);
  }
  return form;
}

describe("drivers server actions", () => {
  beforeEach(() => {
    resetStorageMock();
    revalidatePathMock.mockClear();
    redirectMock.mockClear();
    requireAdminSessionMock.mockReset();
    requireAdminSessionMock.mockReturnValue({
      userId: "admin-test",
      role: "admin",
    });
  });

  it("createDriverAction creates a driver on valid input and redirects", async () => {
    await expect(
      createDriverAction(
        INITIAL_ADMIN_FORM_STATE,
        fd({
          fullName: "Alice Driver",
          email: "alice@test.com",
          phone: "5551230001",
          vehicleLabel: "Van 1",
          active: "on",
        }),
      ),
    ).rejects.toThrow(/REDIRECT:\/admin\/drivers/);

    const drivers = await storageMock.listDrivers();
    expect(drivers).toHaveLength(1);
    expect(drivers[0]?.fullName).toBe("Alice Driver");
    expect(drivers[0]?.active).toBe(true);
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/drivers");
    const accounts = await storageMock.listDriverAccounts();
    expect(accounts[0]?.email).toBe("alice@test.com");
  });

  it("createDriverAction rejects an invalid email with a fieldError", async () => {
    const state = await createDriverAction(
      INITIAL_ADMIN_FORM_STATE,
      fd({
        fullName: "Alice",
        email: "not-an-email",
      }),
    );
    expect(state.fieldErrors.email).toBeTruthy();
    expect(await storageMock.listDrivers()).toHaveLength(0);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("createDriverAction requires a full name", async () => {
    const state = await createDriverAction(
      INITIAL_ADMIN_FORM_STATE,
      fd({ fullName: "", email: "x@test.com" }),
    );
    expect(state.fieldErrors.fullName).toBeTruthy();
    expect(await storageMock.listDrivers()).toHaveLength(0);
  });

  it("updateDriverAction patches an existing driver", async () => {
    const created = await storageMock.createDriver({
      email: "bob@test",
      fullName: "Bob",
      active: true,
    });
    await expect(
      updateDriverAction(
        created.profileId,
        INITIAL_ADMIN_FORM_STATE,
        fd({
          fullName: "Robert",
          phone: "5551230002",
          vehicleLabel: "",
          active: "on",
        }),
      ),
    ).rejects.toThrow(/REDIRECT:\/admin\/drivers/);
    const after = await storageMock.getDriver(created.profileId);
    expect(after?.fullName).toBe("Robert");
    expect(after?.phone).toBe("5551230002");
  });

  it("updateDriverAction returns a state.error when the driver is missing", async () => {
    const state = await updateDriverAction(
      "does-not-exist",
      INITIAL_ADMIN_FORM_STATE,
      fd({ fullName: "Ghost", active: "on" }),
    );
    expect(state.error).toMatch(/not found/);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("deactivateDriverAction sets active=false", async () => {
    const created = await storageMock.createDriver({
      email: "c@test",
      fullName: "Carol",
      active: true,
    });
    await expect(deactivateDriverAction(created.profileId)).rejects.toThrow(
      /REDIRECT:\/admin\/drivers/,
    );
    const after = await storageMock.getDriver(created.profileId);
    expect(after?.active).toBe(false);
  });

  it("createDriverAction bails out on auth failure before touching storage", async () => {
    requireAdminSessionMock.mockImplementationOnce(() => {
      throw new Error("REDIRECT:/login");
    });
    const createSpy = vi.spyOn(storageMock, "createDriver");
    await expect(
      createDriverAction(
        INITIAL_ADMIN_FORM_STATE,
        fd({
          fullName: "Mallory",
          email: "mallory@test.com",
          active: "on",
        }),
      ),
    ).rejects.toThrow(/REDIRECT:\/login/);
    expect(createSpy).not.toHaveBeenCalled();
    expect(await storageMock.listDrivers()).toHaveLength(0);
    createSpy.mockRestore();
  });
});
