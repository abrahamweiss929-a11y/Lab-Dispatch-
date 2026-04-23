import "server-only";
import twilio from "twilio";
import { NotConfiguredError } from "@/lib/errors";
import { normalizeUsPhone } from "@/lib/phone";
import type { SmsSendParams, SmsSendResult, SmsService } from "./sms";

/**
 * Real Twilio-backed implementation of `SmsService.sendSms`.
 *
 * Design constraints:
 *   - Hermetic-by-default: tests mock `twilio`; no real HTTP call is ever
 *     made from the test suite.
 *   - `"server-only"`: webpack/Next will hard-error if this file is pulled
 *     into a Client Component. `TWILIO_AUTH_TOKEN` is a true secret and
 *     this seam is a non-negotiable defense against bundling it into the
 *     browser.
 *   - Lazy env resolution: `NotConfiguredError` fires on first `sendSms`
 *     call, not at construction — matches `ai.real.ts`'s `getClient()` and
 *     `maps.real.ts`'s `getToken()`. Keeps `getServices()` cheap when
 *     `USE_MOCKS=false` but callers never touch SMS. `envVar` on the error
 *     reports the FIRST missing variable in a fixed priority order
 *     (`TWILIO_ACCOUNT_SID` → `TWILIO_AUTH_TOKEN` → `TWILIO_FROM_NUMBER`)
 *     so error messages are deterministic across environments.
 *   - PHI / credential boundary: neither the account SID, the auth token,
 *     nor the message body is ever passed to `console.error` or included
 *     in a thrown `Error.message`. Twilio's own error strings can echo
 *     back the request body and Basic-auth `Authorization` headers, so
 *     the catch block deliberately does not bind the error identifier.
 *     A fixed context string is the entire payload. The test suite
 *     regex-sweeps `console.error` arguments as a belt-and-suspenders
 *     check against regressions.
 */

interface CachedClient {
  client: ReturnType<typeof twilio>;
  from: string;
}

export function createRealSmsService(): SmsService {
  let cached: CachedClient | null = null;

  function getClient(): CachedClient {
    if (cached !== null) return cached;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    if (!accountSid) {
      throw new NotConfiguredError({
        service: "sms (Twilio)",
        envVar: "TWILIO_ACCOUNT_SID",
      });
    }
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      throw new NotConfiguredError({
        service: "sms (Twilio)",
        envVar: "TWILIO_AUTH_TOKEN",
      });
    }
    const rawFrom = process.env.TWILIO_FROM_NUMBER;
    if (!rawFrom) {
      throw new NotConfiguredError({
        service: "sms (Twilio)",
        envVar: "TWILIO_FROM_NUMBER",
      });
    }
    const from = normalizeUsPhone(rawFrom);
    if (from === null) {
      // A misconfigured sender is a config problem, not a per-call
      // runtime error — surface it as `NotConfiguredError` so callers
      // handle it uniformly with the unset-env case.
      throw new NotConfiguredError({
        service: "sms (Twilio)",
        envVar: "TWILIO_FROM_NUMBER",
      });
    }

    cached = { client: twilio(accountSid, authToken), from };
    return cached;
  }

  async function sendSms(params: SmsSendParams): Promise<SmsSendResult> {
    const to = normalizeUsPhone(params.to);
    if (to === null) {
      // Reject before any network attempt — bad caller input, not a
      // Twilio failure.
      throw new Error("sms.sendSms: invalid destination phone number");
    }

    const { client, from } = getClient();
    try {
      const message = await client.messages.create({
        to,
        from,
        body: params.body,
      });
      // The SDK's own `message.status` at this stage is typically
      // `"queued"` or `"accepted"`. The interface contract locks the
      // return value to the literal `"queued"`; widening the union to
      // forward real delivery states is a separate feature (status
      // callbacks).
      return { id: message.sid, status: "queued" as const };
    } catch {
      // DO NOT include the SDK error object, its message, the SID, the
      // token, or `params.body` in any log arg. Twilio's error strings
      // can echo back the request body, and some SDKs stuff
      // `Authorization` headers into `err.config`. A fixed context
      // string is the entire payload. If future debugging needs more
      // signal, add Sentry-with-pre-send-scrub — not `console.error(err)`.
      console.error("sms.sendSms: Twilio send failed");
      throw new Error("sms.sendSms: Twilio send failed");
    }
  }

  return { sendSms };
}
