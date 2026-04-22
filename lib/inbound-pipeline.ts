import { getServices } from "@/interfaces";
import { normalizeUsPhone } from "@/lib/phone";
import type { NewPickupRequest } from "@/interfaces/storage";
import type { PickupUrgency } from "@/lib/types";

export interface InboundMessageInput {
  channel: "sms" | "email";
  /** Raw sender identifier as received. */
  from: string;
  /** Email only. */
  subject?: string;
  body: string;
}

export type InboundPipelineResult =
  | { status: "unknown_sender"; messageId: string }
  | { status: "flagged"; requestId: string; messageId: string }
  | { status: "received"; requestId: string; messageId: string }
  | { status: "error"; messageId?: string };

export const UNKNOWN_SENDER_COPY =
  "Thanks for reaching out. This number/email isn't set up for pickups yet. Please contact the lab directly to register.";

export const FLAGGED_ACK_COPY =
  "Thanks — we got your message and a team member will confirm shortly.";

export function receivedCopy(sampleCount: number | undefined): string {
  const count = sampleCount ?? "your";
  return `We received your pickup request for ${count} samples. A driver will be there within about 2 hours.`;
}

const CONFIDENCE_THRESHOLD = 0.6;

function canonicalFromFor(input: InboundMessageInput): string {
  if (input.channel === "sms") {
    return normalizeUsPhone(input.from) ?? input.from;
  }
  return input.from.trim().toLowerCase();
}

function buildReplySubject(subject: string | undefined): string {
  if (subject !== undefined && subject.trim().length > 0) {
    return `Re: ${subject}`;
  }
  return "Pickup request received";
}

export async function handleInboundMessage(
  input: InboundMessageInput,
): Promise<InboundPipelineResult> {
  const { storage, sms, email, ai } = getServices();
  const canonicalFrom = canonicalFromFor(input);

  const storedMessage = await storage.createMessage({
    channel: input.channel,
    fromIdentifier: canonicalFrom,
    subject: input.subject,
    body: input.body,
  });

  try {
    const office =
      input.channel === "sms"
        ? await storage.findOfficeByPhone(canonicalFrom)
        : await storage.findOfficeByEmail(canonicalFrom);

    if (office === null) {
      if (input.channel === "sms") {
        // Skip the auto-reply when the raw `from` failed to normalize —
        // we should not send to a malformed destination. The message is
        // still stored for dispatcher review.
        const deliverable = normalizeUsPhone(input.from) !== null;
        if (deliverable) {
          await sms.sendSms({
            to: canonicalFrom,
            body: UNKNOWN_SENDER_COPY,
          });
        }
      } else {
        await email.sendEmail({
          to: canonicalFrom,
          subject: buildReplySubject(input.subject),
          body: UNKNOWN_SENDER_COPY,
        });
      }
      return { status: "unknown_sender", messageId: storedMessage.id };
    }

    const parsed = await ai.parsePickupMessage({
      channel: input.channel,
      from: canonicalFrom,
      body: input.body,
    });

    const urgency: PickupUrgency = parsed.urgency ?? "routine";
    const isFlagged = parsed.confidence < CONFIDENCE_THRESHOLD;

    const pickupInput: NewPickupRequest = {
      channel: input.channel,
      officeId: office.id,
      urgency,
      sampleCount: parsed.sampleCount,
      specialInstructions: parsed.specialInstructions,
      sourceIdentifier: canonicalFrom,
      rawMessage: input.body,
      status: isFlagged ? "flagged" : "pending",
      flaggedReason: isFlagged ? "ai_low_confidence" : undefined,
    };

    const request = await storage.createPickupRequest(pickupInput);
    await storage.linkMessageToRequest(storedMessage.id, request.id);

    const replyBody = isFlagged ? FLAGGED_ACK_COPY : receivedCopy(parsed.sampleCount);

    if (input.channel === "sms") {
      await sms.sendSms({ to: canonicalFrom, body: replyBody });
    } else {
      await email.sendEmail({
        to: canonicalFrom,
        subject: buildReplySubject(input.subject),
        body: replyBody,
      });
    }

    return isFlagged
      ? { status: "flagged", requestId: request.id, messageId: storedMessage.id }
      : {
          status: "received",
          requestId: request.id,
          messageId: storedMessage.id,
        };
  } catch (err) {
    console.error("inbound-pipeline error after message stored", err);
    return { status: "error", messageId: storedMessage.id };
  }
}
