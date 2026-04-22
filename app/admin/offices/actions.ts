"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import type { AdminFormState } from "@/lib/admin-form";
import { makeRandomId } from "@/lib/ids";
import { requireAdminSession } from "@/lib/require-admin";
import { ensureUniqueSlug, slugify } from "@/lib/slugify";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATE_RE = /^[A-Z]{2}$/;
const ZIP_RE = /^\d{5}$/;

interface OfficeFormInput {
  name: string;
  slug: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  active: boolean;
}

function readOfficeForm(formData: FormData): OfficeFormInput {
  return {
    name: String(formData.get("name") ?? "").trim(),
    slug: String(formData.get("slug") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    street: String(formData.get("street") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    state: String(formData.get("state") ?? "")
      .trim()
      .toUpperCase(),
    zip: String(formData.get("zip") ?? "").trim(),
    active: formData.get("active") === "on",
  };
}

function validateOfficeShape(
  input: OfficeFormInput,
): Partial<Record<string, string>> {
  const fieldErrors: Partial<Record<string, string>> = {};
  if (input.name.length === 0) fieldErrors.name = "Required";
  if (input.street.length === 0) fieldErrors.street = "Required";
  if (input.city.length === 0) fieldErrors.city = "Required";
  if (input.state.length === 0) {
    fieldErrors.state = "Required";
  } else if (!STATE_RE.test(input.state)) {
    fieldErrors.state = "Use a 2-letter US state code";
  }
  if (input.zip.length === 0) {
    fieldErrors.zip = "Required";
  } else if (!ZIP_RE.test(input.zip)) {
    fieldErrors.zip = "Use a 5-digit ZIP code";
  }
  if (input.phone.length > 0) {
    const stripped = input.phone.replace(/\s/g, "");
    if (stripped.length < 7) fieldErrors.phone = "Phone looks too short";
  }
  if (input.email.length > 0 && !EMAIL_RE.test(input.email)) {
    fieldErrors.email = "Enter a valid email";
  }
  return fieldErrors;
}

async function resolveSlug(
  input: OfficeFormInput,
  existingSlugs: Set<string>,
): Promise<{ ok: true; slug: string } | { ok: false; state: AdminFormState }> {
  const raw = input.slug.length > 0 ? input.slug : input.name;
  let slug: string;
  try {
    slug = await ensureUniqueSlug(raw, async (candidate) =>
      existingSlugs.has(candidate),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("exhausted")) {
      return {
        ok: false,
        state: {
          error: "Slug collision after 99 attempts; pick a different slug.",
          fieldErrors: {},
        },
      };
    }
    return {
      ok: false,
      state: {
        error:
          "Could not derive a URL slug from the name; please enter a slug manually.",
        fieldErrors: {},
      },
    };
  }
  return { ok: true, slug };
}

export async function createOfficeAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  requireAdminSession();
  const input = readOfficeForm(formData);
  const fieldErrors = validateOfficeShape(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const storage = getServices().storage;
  const existing = await storage.listOffices();
  const existingSlugs = new Set(existing.map((o) => o.slug));

  const slugResult = await resolveSlug(input, existingSlugs);
  if (!slugResult.ok) {
    return slugResult.state;
  }

  const pickupUrlToken = makeRandomId(12);

  try {
    await storage.createOffice({
      name: input.name,
      slug: slugResult.slug,
      pickupUrlToken,
      address: {
        street: input.street,
        city: input.city,
        state: input.state,
        zip: input.zip,
      },
      phone: input.phone.length > 0 ? input.phone : undefined,
      email: input.email.length > 0 ? input.email : undefined,
      active: input.active,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not create office",
      fieldErrors: {},
    };
  }

  revalidatePath("/admin/offices");
  redirect("/admin/offices");
}

export async function updateOfficeAction(
  id: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  requireAdminSession();
  const input = readOfficeForm(formData);
  const fieldErrors = validateOfficeShape(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const storage = getServices().storage;
  const existing = await storage.getOffice(id);
  if (!existing) {
    return { error: `office ${id} not found`, fieldErrors: {} };
  }

  const all = await storage.listOffices();
  // Exclude this office's current slug so saving without a rename doesn't
  // collide with itself.
  const existingSlugs = new Set(
    all.filter((o) => o.id !== id).map((o) => o.slug),
  );

  const raw = input.slug.length > 0 ? input.slug : input.name;
  let desiredSlug: string;
  try {
    desiredSlug = slugify(raw);
  } catch {
    return {
      error:
        "Could not derive a URL slug from the name; please enter a slug manually.",
      fieldErrors: {},
    };
  }

  let finalSlug: string;
  if (desiredSlug === existing.slug) {
    finalSlug = existing.slug;
  } else if (existingSlugs.has(desiredSlug)) {
    return {
      error: null,
      fieldErrors: { slug: "Slug is already taken" },
    };
  } else {
    finalSlug = desiredSlug;
  }

  try {
    await storage.updateOffice(id, {
      name: input.name,
      slug: finalSlug,
      address: {
        street: input.street,
        city: input.city,
        state: input.state,
        zip: input.zip,
      },
      phone: input.phone.length > 0 ? input.phone : undefined,
      email: input.email.length > 0 ? input.email : undefined,
      active: input.active,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not update office",
      fieldErrors: {},
    };
  }

  revalidatePath("/admin/offices");
  redirect("/admin/offices");
}

export async function deactivateOfficeAction(id: string): Promise<void> {
  requireAdminSession();
  try {
    await getServices().storage.updateOffice(id, { active: false });
  } catch {
    // See deactivateDriverAction note.
  }
  revalidatePath("/admin/offices");
}

