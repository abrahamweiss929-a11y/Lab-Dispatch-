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
  createOfficeAction,
  deactivateOfficeAction,
  updateOfficeAction,
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

const VALID_ADDRESS = {
  street: "100 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

function officeFormData(overrides: Partial<Record<string, string>> = {}) {
  return fd({
    name: "Acme Clinic",
    slug: "",
    street: VALID_ADDRESS.street,
    city: VALID_ADDRESS.city,
    state: VALID_ADDRESS.state,
    zip: VALID_ADDRESS.zip,
    phone: "",
    email: "",
    active: "on",
    ...overrides,
  });
}

describe("offices server actions", () => {
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

  it("createOfficeAction creates an office with derived slug and 12-char token", async () => {
    await expect(
      createOfficeAction(INITIAL_ADMIN_FORM_STATE, officeFormData()),
    ).rejects.toThrow(/REDIRECT:\/admin\/offices/);
    const offices = await storageMock.listOffices();
    expect(offices).toHaveLength(1);
    expect(offices[0]?.slug).toBe("acme-clinic");
    expect(offices[0]?.pickupUrlToken.length).toBe(12);
    expect(offices[0]?.address.state).toBe("NJ");
    expect(offices[0]?.active).toBe(true);
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/offices");
  });

  it("createOfficeAction disambiguates slug collisions with -2 suffix", async () => {
    await storageMock.createOffice({
      name: "Acme Clinic",
      slug: "acme-clinic",
      pickupUrlToken: "tok-original",
      address: VALID_ADDRESS,
      active: true,
    });
    await expect(
      createOfficeAction(INITIAL_ADMIN_FORM_STATE, officeFormData()),
    ).rejects.toThrow(/REDIRECT:\/admin\/offices/);
    const offices = await storageMock.listOffices();
    const slugs = offices.map((o) => o.slug).sort();
    expect(slugs).toEqual(["acme-clinic", "acme-clinic-2"]);
  });

  it("createOfficeAction returns fieldError for missing required fields", async () => {
    const state = await createOfficeAction(
      INITIAL_ADMIN_FORM_STATE,
      officeFormData({ street: "", zip: "not-a-zip" }),
    );
    expect(state.fieldErrors.street).toBeTruthy();
    expect(state.fieldErrors.zip).toBeTruthy();
    expect(await storageMock.listOffices()).toHaveLength(0);
  });

  it("createOfficeAction returns state.error when name won't slugify", async () => {
    const state = await createOfficeAction(
      INITIAL_ADMIN_FORM_STATE,
      officeFormData({ name: "🙂" }),
    );
    expect(state.error).toMatch(/slug/i);
    expect(await storageMock.listOffices()).toHaveLength(0);
  });

  it("updateOfficeAction rejects a rename to a taken slug", async () => {
    const taken = await storageMock.createOffice({
      name: "Taken",
      slug: "taken-slug",
      pickupUrlToken: "tok-a",
      address: VALID_ADDRESS,
      active: true,
    });
    void taken;
    const target = await storageMock.createOffice({
      name: "Target",
      slug: "target-slug",
      pickupUrlToken: "tok-b",
      address: VALID_ADDRESS,
      active: true,
    });
    const state = await updateOfficeAction(
      target.id,
      INITIAL_ADMIN_FORM_STATE,
      officeFormData({ name: "Target", slug: "taken-slug" }),
    );
    expect(state.fieldErrors.slug).toBeTruthy();
    const after = await storageMock.getOffice(target.id);
    expect(after?.slug).toBe("target-slug");
  });

  it("updateOfficeAction passes when the slug stays the same", async () => {
    const office = await storageMock.createOffice({
      name: "Acme",
      slug: "acme",
      pickupUrlToken: "tok-a",
      address: VALID_ADDRESS,
      active: true,
    });
    await expect(
      updateOfficeAction(
        office.id,
        INITIAL_ADMIN_FORM_STATE,
        officeFormData({ name: "Acme Renamed", slug: "acme" }),
      ),
    ).rejects.toThrow(/REDIRECT:\/admin\/offices/);
    const after = await storageMock.getOffice(office.id);
    expect(after?.name).toBe("Acme Renamed");
    expect(after?.slug).toBe("acme");
  });

  it("deactivateOfficeAction flips active to false", async () => {
    const office = await storageMock.createOffice({
      name: "Acme",
      slug: "acme-deact",
      pickupUrlToken: "tok-a",
      address: VALID_ADDRESS,
      active: true,
    });
    await deactivateOfficeAction(office.id);
    const after = await storageMock.getOffice(office.id);
    expect(after?.active).toBe(false);
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/offices");
  });

  it("createOfficeAction bails out on auth failure before touching storage", async () => {
    requireAdminSessionMock.mockImplementationOnce(() => {
      throw new Error("REDIRECT:/login");
    });
    const createSpy = vi.spyOn(storageMock, "createOffice");
    await expect(
      createOfficeAction(INITIAL_ADMIN_FORM_STATE, officeFormData()),
    ).rejects.toThrow(/REDIRECT:\/login/);
    expect(createSpy).not.toHaveBeenCalled();
    expect(await storageMock.listOffices()).toHaveLength(0);
    createSpy.mockRestore();
  });
});
