"use server";

import { revalidatePath } from "next/cache";
import { getServices } from "@/interfaces";
import { handleInboundMessage } from "@/lib/inbound-pipeline";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import type {
  ReplyChannel,
  ReplyMessageFormState,
  SimulateInboundFormState,
} from "./form-state";

/**
 * Sends a reply to an inbound message via email or SMS, and stores
 * an outgoing record in the `messages` table for the audit trail.
 *
 * Failures DO surface here (unlike the best-effort outbound triggers)
 * because the dispatcher explicitly clicked "send" and needs to know
 * whether it landed. The page shows the error inline.
 */
export async function sendReplyAction(
  _prev: ReplyMessageFormState,
  formData: FormData,
): Promise<ReplyMessageFormState> {
  await requireDispatcherSession();

  const channelRaw = String(formData.get("channel") ?? "").trim();
  const to = String(formData.get("to") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const messageId = String(formData.get("messageId") ?? "").trim();

  const fieldErrors: Partial<Record<"to" | "subject" | "body", string>> = {};
  if (channelRaw !== "email" && channelRaw !== "sms") {
    return {
      status: "error",
      error: "Channel must be 'email' or 'sms'.",
      fieldErrors: {},
    };
  }
  const channel: ReplyChannel = channelRaw;
  if (to.length === 0) {
    fieldErrors.to = "Recipient is required.";
  }
  if (channel === "email" && subject.length === 0) {
    fieldErrors.subject = "Subject is required for email replies.";
  }
  if (body.length === 0) {
    fieldErrors.body = "Body is required.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", error: "Please fill in the required fields.", fieldErrors };
  }

  const services = getServices();
  try {
    if (channel === "email") {
      await services.email.sendEmail({
        to,
        subject,
        textBody: body,
      });
    } else {
      await services.sms.sendSms({
        to,
        body,
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "send failed";
    return {
      status: "error",
      error: `Reply failed: ${detail}`,
      fieldErrors: {},
    };
  }

  // Audit log: store the outgoing reply as a message row. Failures here
  // are logged but don't surface — the reply did go out.
  try {
    await services.storage.createMessage({
      channel,
      fromIdentifier: to,
      subject: channel === "email" ? subject : undefined,
      body,
      pickupRequestId: undefined,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("sendReplyAction: audit-log createMessage failed", err);
  }

  revalidatePath("/dispatcher/messages");
  if (messageId.length > 0) {
    revalidatePath(`/dispatcher/messages/${messageId}`);
  }

  return { status: "ok", sentTo: to, channel, error: null };
}

export async function convertMessageToRequestAction(
  messageId: string,
): Promise<void> {
  await requireDispatcherSession();
  await getServices().storage.createRequestFromMessage(messageId);
  revalidatePath("/dispatcher/messages");
  revalidatePath("/dispatcher/requests");
}

function bannerFor(
  resultStatus: "received" | "flagged" | "unknown_sender" | "error",
): string {
  switch (resultStatus) {
    case "received":
      return "Simulated — created pickup request.";
    case "flagged":
      return "Simulated — created flagged request.";
    case "unknown_sender":
      return "Simulated — auto-replied to unknown sender.";
    case "error":
      return "Simulated — pipeline errored. See server logs.";
  }
}

export async function simulateInboundAction(
  _prev: SimulateInboundFormState,
  formData: FormData,
): Promise<SimulateInboundFormState> {
  await requireDispatcherSession();

  if (process.env.USE_MOCKS === "false") {
    throw new Error("Simulate inbound is disabled in real mode");
  }

  const channelRaw = String(formData.get("channel") ?? "").trim();
  const from = String(formData.get("from") ?? "").trim();
  const subjectRaw = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (channelRaw !== "sms" && channelRaw !== "email") {
    return { status: "error", message: "Channel must be 'sms' or 'email'." };
  }
  if (from.length === 0) {
    return { status: "error", message: "From is required." };
  }
  if (body.length === 0) {
    return { status: "error", message: "Body is required." };
  }

  const channel: "sms" | "email" = channelRaw;
  const subject = channel === "email" && subjectRaw.length > 0 ? subjectRaw : undefined;

  const result = await handleInboundMessage({
    channel,
    from,
    subject,
    body,
  });

  revalidatePath("/dispatcher/messages");
  revalidatePath("/dispatcher/requests");

  return { status: "ok", message: bannerFor(result.status) };
}
