"use server";

import { revalidatePath } from "next/cache";
import { getServices } from "@/interfaces";
import { handleInboundMessage } from "@/lib/inbound-pipeline";
import { requireDispatcherSession } from "@/lib/require-dispatcher";

export async function convertMessageToRequestAction(
  messageId: string,
): Promise<void> {
  await requireDispatcherSession();
  await getServices().storage.createRequestFromMessage(messageId);
  revalidatePath("/dispatcher/messages");
  revalidatePath("/dispatcher/requests");
}

export type SimulateInboundFormState =
  | { status: "idle"; message: null }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export const INITIAL_SIMULATE_INBOUND_STATE: SimulateInboundFormState = {
  status: "idle",
  message: null,
};

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
