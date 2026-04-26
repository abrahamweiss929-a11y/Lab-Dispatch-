import { timingSafeEqual } from "node:crypto";
import { NotConfiguredError } from "@/lib/errors";

const POSTMARK_API_URL = "https://api.postmarkapp.com/email";

/**
 * Outbound send shape. The adapter is provider-agnostic at the
 * call site, but field names line up with Postmark's `/email` body
 * (TextBody/HtmlBody) so the adapter has a thin mapping job.
 */
export interface EmailSendParams {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  /** Optional display name; rendered as "Name <from@email>". */
  fromName?: string;
  replyTo?: string;
}

export interface EmailSendResult {
  messageId: string;
}

export interface SentEmailRecord extends EmailSendParams, EmailSendResult {
  sentAt: string;
}

/**
 * Normalized inbound webhook payload. Always returns strings (empty
 * if a field is missing) so callers don't have to null-check every
 * field. The pipeline applies its own validation (rate-limit, sender
 * match) on top.
 */
export interface ParsedInboundEmail {
  fromEmail: string;
  fromName: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  messageId: string;
}

export interface EmailService {
  sendEmail(params: EmailSendParams): Promise<EmailSendResult>;
}

/**
 * Format a From header. If `fromName` is set, returns "Name <email>"
 * (RFC 5322-style). Otherwise returns the bare email.
 */
export function formatFrom(email: string, fromName?: string): string {
  const name = fromName?.trim();
  if (name !== undefined && name.length > 0) {
    return `${name} <${email}>`;
  }
  return email;
}

/**
 * Extract the bare email from a `Name <addr@host>` string. Falls
 * back to the input trimmed if no angle brackets are present.
 */
function extractBareEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  if (match !== null && match[1] !== undefined) {
    return match[1].trim();
  }
  return raw.trim();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Parse a Postmark inbound webhook JSON payload into a normalized
 * shape. Postmark sends `FromFull` (object), `From` (formatted
 * string), `FromName`, `Subject`, `TextBody`, `HtmlBody`, `MessageID`.
 * We prefer `FromFull.Email` because it's the cleanest extracted
 * address; we fall back to parsing `From` if it's not present.
 */
export function parseInboundWebhook(payload: unknown): ParsedInboundEmail {
  const obj =
    payload !== null && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const fromFullRaw = obj.FromFull;
  const fromFull =
    fromFullRaw !== null && typeof fromFullRaw === "object"
      ? (fromFullRaw as Record<string, unknown>)
      : null;

  const fromEmailFromFull = fromFull !== null ? asString(fromFull.Email) : "";
  const fromNameFromFull = fromFull !== null ? asString(fromFull.Name) : "";

  const rawFrom = asString(obj.From);
  const fromEmail =
    fromEmailFromFull.length > 0 ? fromEmailFromFull : extractBareEmail(rawFrom);

  const fromName =
    fromNameFromFull.length > 0 ? fromNameFromFull : asString(obj.FromName);

  return {
    fromEmail,
    fromName,
    subject: asString(obj.Subject),
    bodyText: asString(obj.TextBody),
    bodyHtml: asString(obj.HtmlBody),
    messageId: asString(obj.MessageID),
  };
}

/**
 * Validate the `?token=` query param against
 * `POSTMARK_INBOUND_WEBHOOK_TOKEN`. Constant-time compare. Returns
 * false (fail-closed) if the env var is unset, the URL has no
 * token, or the lengths differ — `timingSafeEqual` requires equal
 * lengths and the length check itself is not constant-time, but
 * the env-var length is fixed at deploy time so this leaks nothing
 * about the secret.
 */
export function verifyInboundSignature(request: Request): boolean {
  const expected = process.env.POSTMARK_INBOUND_WEBHOOK_TOKEN;
  if (expected === undefined || expected.length === 0) {
    return false;
  }

  let token: string | null;
  try {
    const url = new URL(request.url);
    token = url.searchParams.get("token");
  } catch {
    return false;
  }
  if (token === null || token.length === 0) {
    return false;
  }
  if (token.length !== expected.length) {
    return false;
  }

  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  return timingSafeEqual(tokenBuf, expectedBuf);
}

/**
 * Real Postmark email adapter. Reads `POSTMARK_SERVER_TOKEN` and
 * `POSTMARK_FROM_EMAIL` from env at call time (not module load) so
 * the adapter is testable. Throws `NotConfiguredError` if either is
 * missing — callers wrap in try/catch so business actions don't fail
 * because email isn't configured.
 *
 * Returns `{ messageId }` on a 2xx Postmark response. Throws on
 * non-2xx with a short snippet of the response body for diagnostics.
 */
export function createRealEmailService(): EmailService {
  return {
    async sendEmail(params: EmailSendParams): Promise<EmailSendResult> {
      const token = process.env.POSTMARK_SERVER_TOKEN;
      if (token === undefined || token.length === 0) {
        throw new NotConfiguredError({
          service: "email (Postmark)",
          envVar: "POSTMARK_SERVER_TOKEN",
        });
      }
      const fromEmail = process.env.POSTMARK_FROM_EMAIL;
      if (fromEmail === undefined || fromEmail.length === 0) {
        throw new NotConfiguredError({
          service: "email (Postmark)",
          envVar: "POSTMARK_FROM_EMAIL",
        });
      }

      const requestBody: Record<string, string> = {
        From: formatFrom(fromEmail, params.fromName),
        To: params.to,
        Subject: params.subject,
        TextBody: params.textBody,
      };
      if (params.htmlBody !== undefined && params.htmlBody.length > 0) {
        requestBody.HtmlBody = params.htmlBody;
      }
      if (params.replyTo !== undefined && params.replyTo.length > 0) {
        requestBody.ReplyTo = params.replyTo;
      }

      const res = await fetch(POSTMARK_API_URL, {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.text()).slice(0, 200);
        } catch {
          // ignore — surface just the status
        }
        throw new Error(
          `Postmark sendEmail failed: ${res.status} ${detail}`.trim(),
        );
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new Error("Postmark sendEmail: malformed response body");
      }
      const messageId =
        json !== null &&
        typeof json === "object" &&
        typeof (json as { MessageID?: unknown }).MessageID === "string"
          ? (json as { MessageID: string }).MessageID
          : "";
      return { messageId };
    },
  };
}
