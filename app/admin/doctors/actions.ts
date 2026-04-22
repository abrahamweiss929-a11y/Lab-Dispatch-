"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import type { AdminFormState } from "@/lib/admin-form";
import { requireAdminSession } from "@/lib/require-admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface DoctorFormInput {
  officeId: string;
  name: string;
  phone: string;
  email: string;
}

function readDoctorForm(formData: FormData): DoctorFormInput {
  return {
    officeId: String(formData.get("officeId") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
  };
}

function validateDoctorShape(
  input: DoctorFormInput,
): Partial<Record<string, string>> {
  const fieldErrors: Partial<Record<string, string>> = {};
  if (input.officeId.length === 0) {
    fieldErrors.officeId = "Choose an office";
  }
  if (input.name.length === 0) {
    fieldErrors.name = "Required";
  }
  if (input.phone.length > 0) {
    const stripped = input.phone.replace(/\s/g, "");
    if (stripped.length < 7) {
      fieldErrors.phone = "Phone looks too short";
    }
  }
  if (input.email.length > 0 && !EMAIL_RE.test(input.email)) {
    fieldErrors.email = "Enter a valid email";
  }
  return fieldErrors;
}

export async function createDoctorAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  requireAdminSession();
  const input = readDoctorForm(formData);
  const fieldErrors = validateDoctorShape(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const storage = getServices().storage;
  const office = await storage.getOffice(input.officeId);
  if (!office) {
    return { error: null, fieldErrors: { officeId: "Office not found" } };
  }

  try {
    await storage.createDoctor({
      officeId: input.officeId,
      name: input.name,
      phone: input.phone.length > 0 ? input.phone : undefined,
      email: input.email.length > 0 ? input.email : undefined,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not create doctor",
      fieldErrors: {},
    };
  }

  revalidatePath("/admin/doctors");
  redirect("/admin/doctors");
}

export async function updateDoctorAction(
  id: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  requireAdminSession();
  const input = readDoctorForm(formData);
  const fieldErrors = validateDoctorShape(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const storage = getServices().storage;
  const existing = await storage.getDoctor(id);
  if (!existing) {
    return { error: `doctor ${id} not found`, fieldErrors: {} };
  }
  if (input.officeId !== existing.officeId) {
    const office = await storage.getOffice(input.officeId);
    if (!office) {
      return { error: null, fieldErrors: { officeId: "Office not found" } };
    }
  }

  try {
    await storage.updateDoctor(id, {
      officeId: input.officeId,
      name: input.name,
      phone: input.phone.length > 0 ? input.phone : undefined,
      email: input.email.length > 0 ? input.email : undefined,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not update doctor",
      fieldErrors: {},
    };
  }

  revalidatePath("/admin/doctors");
  redirect("/admin/doctors");
}

export async function deleteDoctorAction(id: string): Promise<void> {
  requireAdminSession();
  try {
    await getServices().storage.deleteDoctor(id);
  } catch {
    // See deactivateDriverAction note; the list-page re-render is the
    // source of truth for UI state.
  }
  revalidatePath("/admin/doctors");
  redirect("/admin/doctors");
}

