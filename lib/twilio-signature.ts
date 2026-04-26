import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio webhook signature verification.
 *
 * Algorithm (per Twilio docs):
 *   1. Start with the full request URL exactly as Twilio called it
 *      (including scheme, host, path, and any query string).
 *   2. Sort the POST form parameters alphabetically by key.
 *   3. Append each `key + value` (no separator) to the URL.
 *   4. HMAC-SHA1 the result using the account's auth token as the key.
 *   5. Base64-encode the digest.
 *   6. Constant-time compare against the `X-Twilio-Signature` header.
 *
 * We never log the auth token, signature, or raw body. The "url" passed
 * here is the URL Twilio signed — usually the public webhook URL — which
 * may differ from `req.url` behind proxies; callers must reconstruct it
 * (e.g. respecting `x-forwarded-proto` / `x-forwarded-host`).
 */
export function computeTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
): string {
  const sortedKeys = Object.keys(params).sort();
  let payload = url;
  for (const key of sortedKeys) {
    payload += key + params[key];
  }
  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

export function verifyTwilioSignature(args: {
  url: string;
  params: Record<string, string>;
  authToken: string;
  headerSignature: string | null | undefined;
}): boolean {
  const { url, params, authToken, headerSignature } = args;
  if (typeof headerSignature !== "string" || headerSignature.length === 0) {
    return false;
  }
  const expected = computeTwilioSignature(url, params, authToken);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(headerSignature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Reconstructs the URL Twilio signed from the incoming request.
 *
 * Twilio signs the URL it called — behind a proxy, `req.url` may be the
 * internal URL while Twilio called the public one. Honor
 * `x-forwarded-proto` / `x-forwarded-host` when present. The query string
 * (if any) is included.
 */
export function reconstructWebhookUrl(req: Request): string {
  const original = new URL(req.url);
  const headers = req.headers;
  const proto = headers.get("x-forwarded-proto") ?? original.protocol.replace(/:$/, "");
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? original.host;
  return `${proto}://${host}${original.pathname}${original.search}`;
}
