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
  createDoctorAction,
  deleteDoctorAction,
  updateDoctorAction,
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

const ADDRESS = {
  street: "100 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

async function seedOffice(name = "Acme Clinic") {
  return storageMock.createOffice({
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    pickupUrlToken: "tok-" + name.toLowerCase().replace(/\s+/g, "-"),
    address: ADDRESS,
    active: true,
  });
}

describe("doctors server actions", () => {
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

  it("createDoctorAction creates a doctor and redirects", async () => {
    const office = await seedOffice();
    await expect(
      createDoctorAction(
        INITIAL_ADMIN_FORM_STATE,
        fd({
          officeId: office.id,
          name: "Dr. Smith",
          phone: "5551230001",
          email: "smith@test.com",
        }),
      ),
    ).rejects.toThrow(/REDIRECT:\/admin\/doctors/);
    const doctors = await storageMock.listDoctors();
    expect(doctors).toHaveLength(1);
    expect(doctors[0]?.name).toBe("Dr. Smith");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/doctors");
  });

  it("createDoctorAction rejects an unknown officeId", async () => {
    await seedOffice();
    const state = await createDoctorAction(
      INITIAL_ADMIN_FORM_STATE,
      fd({
        officeId: "office-missing",
        name: "Dr. Smith",
      }),
    );
    expect(state.fieldErrors.officeId).toBe("Office not found");
    expect(await storageMock.listDoctors()).toHaveLength(0);
  });

  it("createDoctorAction requires a name", async () => {
    const office = await seedOffice();
    const state = await createDoctorAction(
      INITIAL_ADMIN_FORM_STATE,
      fd({ officeId: office.id, name: "" }),
    );
    expect(state.fieldErrors.name).toBeTruthy();
  });

  it("updateDoctorAction patches a doctor", async () => {
    const office = await seedOffice();
    const doctor = await storageMock.createDoctor({
      officeId: office.id,
      name: "Dr. Old",
    });
    await expect(
      updateDoctorAction(
        doctor.id,
        INITIAL_ADMIN_FORM_STATE,
        fd({
          officeId: office.id,
          name: "Dr. New",
          phone: "",
          email: "",
        }),
      ),
    ).rejects.toThrow(/REDIRECT:\/admin\/doctors/);
    const after = await storageMock.getDoctor(doctor.id);
    expect(after?.name).toBe("Dr. New");
  });

  it("updateDoctorAction rejects a switch to an unknown office", async () => {
    const office = await seedOffice();
    const doctor = await storageMock.createDoctor({
      officeId: office.id,
      name: "Dr. Stable",
    });
    const state = await updateDoctorAction(
      doctor.id,
      INITIAL_ADMIN_FORM_STATE,
      fd({
        officeId: "missing-office",
        name: "Dr. Stable",
      }),
    );
    expect(state.fieldErrors.officeId).toBe("Office not found");
    const after = await storageMock.getDoctor(doctor.id);
    expect(after?.officeId).toBe(office.id);
  });

  it("deleteDoctorAction removes the doctor", async () => {
    const office = await seedOffice();
    const doctor = await storageMock.createDoctor({
      officeId: office.id,
      name: "Dr. Gone",
    });
    await expect(deleteDoctorAction(doctor.id)).rejects.toThrow(
      /REDIRECT:\/admin\/doctors/,
    );
    expect(await storageMock.getDoctor(doctor.id)).toBeNull();
  });

  it("createDoctorAction bails out on auth failure before touching storage", async () => {
    const office = await seedOffice();
    requireAdminSessionMock.mockImplementationOnce(() => {
      throw new Error("REDIRECT:/login");
    });
    const createSpy = vi.spyOn(storageMock, "createDoctor");
    await expect(
      createDoctorAction(
        INITIAL_ADMIN_FORM_STATE,
        fd({
          officeId: office.id,
          name: "Dr. Evil",
        }),
      ),
    ).rejects.toThrow(/REDIRECT:\/login/);
    expect(createSpy).not.toHaveBeenCalled();
    expect(await storageMock.listDoctors()).toHaveLength(0);
    createSpy.mockRestore();
  });
});
