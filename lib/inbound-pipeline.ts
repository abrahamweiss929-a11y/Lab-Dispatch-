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
  | {
      status: "received";
      requestId: string;
      messageId: string;
      /**
       * For SMS channel ONLY: the auto-confirmation body the route
       * handler should return as TwiML so Twilio delivers it inline.
       * Email channel sends the confirmation directly via the email
       * adapter and does not populate this. Undefined when no
       * auto-reply should be sent.
       */
      smsAutoReplyBody?: string;
    }
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
  // `sms` is intentionally absent: SMS auto-replies are returned via
  // TwiML from the route handler, not via a separate Twilio API call.
  const { storage, email, ai } = getServices();
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
      // SMS path: the route handler returns empty TwiML — Twilio
      // expects every webhook response to be valid TwiML, and no
      // auto-reply is the right behavior for unmatched senders
      // (avoids confirming our number/email is monitored to spam).
      // Email path: still sends the polite brush-off via separate API.
      if (input.channel === "email") {
        try {
          await email.sendEmail({
            to: canonicalFrom,
            subject: buildReplySubject(input.subject),
            textBody: UNKNOWN_SENDER_COPY,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            "inbound-pipeline: unknown-sender email reply failed",
            err,
          );
        }
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

    // Auto-confirmation policy: send a polite ack ONLY for non-flagged
    // requests where the sender matched a known office. Flagged
    // requests get human review first — the dispatcher decides whether
    // to confirm. This avoids confirming bad parses to the sender.
    //
    // SMS path: do NOT call sms.sendSms — Twilio expects the
    // confirmation back inline as TwiML in the webhook response. The
    // pipeline returns the body via `smsAutoReplyBody`; the route
    // handler emits TwiML. (Twilio error 12300 fires when the webhook
    // returns the wrong Content-Type, so the route handler is the
    // single source of truth for the response shape.)
    let smsAutoReplyBody: string | undefined;
    if (!isFlagged) {
      const officeName = office.name;
      if (input.channel === "sms") {
        smsAutoReplyBody = `Lab Dispatch: pickup request received from ${officeName}. A driver will be assigned shortly.`;
      } else {
        try {
          await email.sendEmail({
            to: canonicalFrom,
            subject: "Pickup request received — Lab Dispatch",
            textBody: `We've received your pickup request from ${officeName}. A driver will be assigned shortly.\n\n— Lab Dispatch`,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            "inbound-pipeline: auto-confirmation email failed",
            err,
          );
        }
      }
    }

    if (isFlagged) {
      return {
        status: "flagged",
        requestId: request.id,
        messageId: storedMessage.id,
      };
    }
    return {
      status: "received",
      requestId: request.id,
      messageId: storedMessage.id,
      smsAutoReplyBody,
    };
  } catch (err) {
    console.error("inbound-pipeline error after message stored", err);
    return { status: "error", messageId: storedMessage.id };
  }
}
