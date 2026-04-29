/**
 * Tiny TwiML response helpers. Twilio expects webhook responses to be
 * `Content-Type: text/xml` with a `<Response>` root. Returning JSON
 * triggers Twilio error 12300 ("Invalid Content-Type").
 *
 * For inline auto-replies, wrap the message in `<Message>...</Message>`.
 * For "no auto-reply" (unmatched sender, flagged request, error path),
 * return an empty `<Response></Response>` — still valid TwiML, still
 * the correct Content-Type.
 */

const XML_DECL = `<?xml version="1.0" encoding="UTF-8"?>`;

/** XML-escape a body string. Twilio Message bodies are plain text but
 * any `&`, `<`, `>` must be escaped to keep the XML well-formed. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Empty TwiML response — no auto-reply. */
export function emptyTwimlResponse(): string {
  return `${XML_DECL}<Response></Response>`;
}

/** TwiML response with a single inline `<Message>`. */
export function messageTwimlResponse(body: string): string {
  return `${XML_DECL}<Response><Message>${escapeXml(body)}</Message></Response>`;
}

/**
 * Build a Response with the correct Content-Type for Twilio. Always
 * 200 status so Twilio treats the webhook as successful — empty body
 * means "no auto-reply" rather than "failure".
 */
export function twimlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}
