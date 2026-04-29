"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import type { AdminFormState } from "@/lib/admin-form";
import { todayIso } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import type { PickupUrgency } from "@/lib/types";

const URGENCIES: readonly PickupUrgency[] = ["routine", "urgent", "stat"];

export async function assignRequestToRouteAction(
  requestId: string,
  formData: FormData,
): Promise<void> {
  await requireDispatcherSession();
  const routeId = String(formData.get("routeId") ?? "").trim();
  if (routeId.length === 0) {
    return;
  }
  await getServices().storage.assignRequestToRoute(routeId, requestId);
  revalidatePath("/dispatcher/requests");
  revalidatePath(`/dispatcher/routes/${routeId}`);
}

/**
 * "Assign to driver" — picks the driver's active/pending route for
 * today, or creates one when none exists. Returns nothing; side
 * effects: pickup_requests row gets assigned to a stop, and a route
 * may be newly created.
 */
export async function assignRequestToDriverAction(
  requestId: string,
  formData: FormData,
): Promise<void> {
  await requireDispatcherSession();
  const driverId = String(formData.get("driverId") ?? "").trim();
  if (driverId.length === 0) return;

  const storage = getServices().storage;
  const today = todayIso();

  // Find an existing route for this driver for today (any non-completed
  // status). If none, create a fresh pending route.
  const todaysRoutes = await storage.listRoutes({
    driverId,
    date: today,
  });
  const usable = todaysRoutes.find(
    (r) => r.status === "active" || r.status === "pending",
  );

  let routeId: string;
  if (usable) {
    routeId = usable.id;
  } else {
    const created = await storage.createRoute({
      driverId,
      routeDate: today,
    });
    routeId = created.id;
  }

  await storage.assignRequestToRoute(routeId, requestId);
  revalidatePath("/dispatcher/requests");
  revalidatePath(`/dispatcher/routes/${routeId}`);
  revalidatePath("/dispatcher/routes");
}

export async function flagRequestAction(
  requestId: string,
  formData: FormData,
): Promise<void> {
  await requireDispatcherSession();
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length === 0) {
    return;
  }
  await getServices().storage.updatePickupRequestStatus(
    requestId,
    "flagged",
    reason,
  );
  revalidatePath("/dispatcher/requests");
}

export async function markResolvedAction(requestId: string): Promise<void> {
  await requireDispatcherSession();
  await getServices().storage.updatePickupRequestStatus(
    requestId,
    "completed",
  );
  revalidatePath("/dispatcher/requests");
}

interface ManualRequestInput {
  officeId: string;
  urgency: string;
  sampleCount: string;
  specialInstructions: string;
}

function readManualForm(formData: FormData): ManualRequestInput {
  return {
    officeId: String(formData.get("officeId") ?? "").trim(),
    urgency: String(formData.get("urgency") ?? "routine").trim(),
    sampleCount: String(formData.get("sampleCount") ?? "").trim(),
    specialInstructions: String(
      formData.get("specialInstructions") ?? "",
    ).trim(),
  };
}

function validateManualInput(
  input: ManualRequestInput,
): Partial<Record<string, string>> {
  const fieldErrors: Partial<Record<string, string>> = {};
  if (input.officeId.length === 0) {
    fieldErrors.officeId = "Choose an office";
  }
  if (!URGENCIES.includes(input.urgency as PickupUrgency)) {
    fieldErrors.urgency = "Choose an urgency";
  }
  if (input.sampleCount.length > 0) {
    const n = Number(input.sampleCount);
    if (!Number.isInteger(n) || n < 1) {
      fieldErrors.sampleCount = "Enter a positive integer";
    }
  }
  return fieldErrors;
}

export async function createManualRequestAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireDispatcherSession();
  const input = readManualForm(formData);
  const fieldErrors = validateManualInput(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  const storage = getServices().storage;
  const office = await storage.getOffice(input.officeId);
  if (!office) {
    return { error: null, fieldErrors: { officeId: "Office not found" } };
  }

  try {
    await storage.createPickupRequest({
      channel: "manual",
      officeId: input.officeId,
      urgency: input.urgency as PickupUrgency,
      sampleCount:
        input.sampleCount.length > 0 ? Number(input.sampleCount) : undefined,
      specialInstructions:
        input.specialInstructions.length > 0
          ? input.specialInstructions
          : undefined,
      status: "pending",
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not create request",
      fieldErrors: {},
    };
  }

  revalidatePath("/dispatcher/requests");
  redirect("/dispatcher/requests");
}
