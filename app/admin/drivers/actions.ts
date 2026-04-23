"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import type { AdminFormState } from "@/lib/admin-form";
import { requireAdminSession } from "@/lib/require-admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface DriverFormInput {
  fullName: string;
  email: string;
  phone: string;
  vehicleLabel: string;
  active: boolean;
}

function readDriverForm(formData: FormData): DriverFormInput {
  return {
    fullName: String(formData.get("fullName") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    vehicleLabel: String(formData.get("vehicleLabel") ?? "").trim(),
    active: formData.get("active") === "on",
  };
}

function validateDriverForm(
  input: DriverFormInput,
  { requireEmail }: { requireEmail: boolean },
): Partial<Record<string, string>> {
  const fieldErrors: Partial<Record<string, string>> = {};
  if (input.fullName.length === 0) {
    fieldErrors.fullName = "Required";
  }
  if (requireEmail) {
    if (input.email.length === 0) {
      fieldErrors.email = "Enter a valid email";
    } else if (!EMAIL_RE.test(input.email)) {
      fieldErrors.email = "Enter a valid email";
    }
  }
  if (input.phone.length > 0) {
    const stripped = input.phone.replace(/\s/g, "");
    if (stripped.length < 7) {
      fieldErrors.phone = "Phone looks too short";
    }
  }
  return fieldErrors;
}

export async function createDriverAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdminSession();
  const input = readDriverForm(formData);
  const fieldErrors = validateDriverForm(input, { requireEmail: true });
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  try {
    await getServices().storage.createDriver({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone.length > 0 ? input.phone : undefined,
      vehicleLabel:
        input.vehicleLabel.length > 0 ? input.vehicleLabel : undefined,
      active: input.active,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not create driver",
      fieldErrors: {},
    };
  }

  revalidatePath("/admin/drivers");
  redirect("/admin/drivers");
}

export async function updateDriverAction(
  profileId: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdminSession();
  const input = readDriverForm(formData);
  const fieldErrors = validateDriverForm(input, { requireEmail: false });
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  try {
    await getServices().storage.updateDriver(profileId, {
      fullName: input.fullName,
      phone: input.phone.length > 0 ? input.phone : undefined,
      vehicleLabel:
        input.vehicleLabel.length > 0 ? input.vehicleLabel : undefined,
      active: input.active,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not update driver",
      fieldErrors: {},
    };
  }

  revalidatePath("/admin/drivers");
  redirect("/admin/drivers");
}

export async function deactivateDriverAction(profileId: string): Promise<void> {
  await requireAdminSession();
  try {
    await getServices().storage.updateDriver(profileId, { active: false });
  } catch {
    // Storage errors are swallowed on this button-level action because
    // there is no state surface; the list page's next render reflects
    // reality regardless.
  }
  revalidatePath("/admin/drivers");
  redirect("/admin/drivers");
}

