"use server";

import { getServices } from "@/interfaces";
import { estimateEtaText } from "@/lib/eta";
import { parseSlugToken } from "@/lib/parse-slug-token";
import { pickupFormBucket } from "@/lib/rate-limit";
import type { PickupUrgency } from "@/lib/types";
import type { PickupFormState } from "./form-state";

type FieldKey = "notes" | "urgency" | "sampleCount";
type FieldErrors = Partial<Record<FieldKey, string>>;

const URGENCIES: readonly PickupUrgency[] = ["routine", "urgent", "stat"];

function isUrgency(value: string): value is PickupUrgency {
  return (URGENCIES as readonly string[]).includes(value);
}

// PUBLIC endpoint — there is deliberately NO session check here. The
// `/pickup/*` prefix is in `PUBLIC_PATH_PREFIXES` (lib/auth-rules.ts),
// and the `pickupFormBucket` rate limiter is the only abuse guard.
export async function submitPickupRequestAction(
  _prev: PickupFormState,
  formData: FormData,
): Promise<PickupFormState> {
  const slugToken = String(formData.get("slugToken") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const urgencyRaw = String(formData.get("urgency") ?? "").trim();
  const sampleCountRaw = String(formData.get("sampleCount") ?? "").trim();

  if (slugToken.length === 0) {
    return {
      status: "error",
      error: "This pickup link is no longer valid.",
      fieldErrors: {},
    };
  }

  if (!pickupFormBucket.tryConsume(slugToken)) {
    return {
      status: "error",
      error: "Too many requests. Please wait a few minutes and try again.",
      fieldErrors: {},
    };
  }

  if (parseSlugToken(slugToken) === null) {
    return {
      status: "error",
      error: "This pickup link is no longer valid.",
      fieldErrors: {},
    };
  }

  const fieldErrors: FieldErrors = {};

  if (notes.length < 10) {
    fieldErrors.notes = "Please share at least 10 characters so we know what to pick up.";
  } else if (notes.length > 1000) {
    fieldErrors.notes = "Please keep notes under 1000 characters.";
  }

  const urgency: PickupUrgency =
    urgencyRaw.length === 0 ? "routine" : (urgencyRaw as PickupUrgency);
  if (urgencyRaw.length > 0 && !isUrgency(urgencyRaw)) {
    fieldErrors.urgency = "Choose routine, urgent, or stat.";
  }

  let sampleCount: number | undefined;
  if (sampleCountRaw.length > 0) {
    const n = Number(sampleCountRaw);
    if (!Number.isInteger(n) || n < 1 || n > 99) {
      fieldErrors.sampleCount = "Enter a whole number from 1 to 99.";
    } else {
      sampleCount = n;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", error: null, fieldErrors };
  }

  const parsed = parseSlugToken(slugToken);
  // parsed was non-null above; narrow for TS.
  if (parsed === null) {
    return {
      status: "error",
      error: "This pickup link is no longer valid.",
      fieldErrors: {},
    };
  }

  const services = getServices();
  const office = await services.storage.findOfficeBySlugToken(
    parsed.slug,
    parsed.token,
  );
  if (office === null) {
    return {
      status: "error",
      error: "This pickup link is no longer valid.",
      fieldErrors: {},
    };
  }

  const request = await services.storage.createPickupRequest({
    channel: "web",
    officeId: office.id,
    sourceIdentifier: slugToken,
    rawMessage: notes,
    urgency,
    sampleCount,
    specialInstructions: notes,
    status: "pending",
  });

  const etaText = estimateEtaText();

  // Best-effort auto-confirmation email. Silent no-op when the office
  // has no email on file; failures are swallowed so the pickup request
  // is not rolled back on a transient email outage.
  if (office.email !== undefined && office.email.length > 0) {
    try {
      await services.email.sendEmail({
        to: office.email,
        subject: `Pickup request received — ${office.name}`,
        textBody: `We got your request. ETA: ${etaText}. Notes: ${notes}`,
      });
    } catch {
      // Intentionally swallowed; the request is already persisted.
    }
  }

  // Best-effort SMS confirmation. Silent no-op when the office has no
  // phone on file. Failures are swallowed for the same reason as email:
  // the pickup is already persisted; a Twilio outage shouldn't roll it
  // back or surface as a user-facing error.
  if (office.phone !== undefined && office.phone.length > 0) {
    try {
      await services.sms.sendSms({
        to: office.phone,
        body: `Lab Dispatch: pickup request received for ${office.name}. Driver will arrive ${etaText}. Reply STOP to opt out.`,
      });
    } catch {
      // Intentionally swallowed.
    }
  }

  return { status: "ok", requestId: request.id, etaText };
}
