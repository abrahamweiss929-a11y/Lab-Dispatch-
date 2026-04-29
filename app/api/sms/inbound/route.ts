import { NextResponse } from "next/server";
import { handleInboundMessage } from "@/lib/inbound-pipeline";
import { smsInboundBucket } from "@/lib/inbound-rate-limits";
import {
  emptyTwimlResponse,
  messageTwimlResponse,
  twimlResponse,
} from "@/lib/twiml";
import {
  reconstructWebhookUrl,
  verifyTwilioSignature,
} from "@/lib/twilio-signature";

// PUBLIC endpoint — no session check. Authenticity is enforced by the
// Twilio signature header (`X-Twilio-Signature`); requests without a
// valid HMAC-SHA1 signature over (URL + sorted POST params) are rejected
// with 403. `smsInboundBucket` adds per-sender abuse protection on top.
//
// The auth token is read lazily from `TWILIO_AUTH_TOKEN`. When the token
// is unset, the route deliberately returns 503 — fail-closed: we'd
// rather drop messages than accept unsigned ones in production.
//
// Response shape: TwiML XML. Twilio rejects any other Content-Type
// with error 12300 ("Invalid Content-Type"). Auto-replies are returned
// inline via `<Message>...</Message>` so we don't pay a separate
// Twilio API roundtrip and the webhook stays under Twilio's 15-second
// response budget.
export async function POST(req: Request): Promise<Response> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || authToken.length === 0) {
    // Don't leak whether the token is missing vs. wrong; just refuse.
    console.error("inbound SMS: TWILIO_AUTH_TOKEN not configured");
    return NextResponse.json({ status: "not_configured" }, { status: 503 });
  }

  // Twilio sends `application/x-www-form-urlencoded`. Parse the raw body
  // ourselves so we keep a `Record<string, string>` for the signature
  // check that matches exactly what we hand to the pipeline.
  let params: Record<string, string>;
  try {
    const raw = await req.text();
    const search = new URLSearchParams(raw);
    params = {};
    for (const [k, v] of search.entries()) {
      params[k] = v;
    }
  } catch {
    // Bad payload — give Twilio a valid TwiML response anyway (so it
    // doesn't log 12300) but with a 400 status so Twilio reports the
    // failed-delivery in its dashboard.
    return new Response(emptyTwimlResponse(), {
      status: 400,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }

  const url = reconstructWebhookUrl(req);
  const headerSignature = req.headers.get("x-twilio-signature");
  const ok = verifyTwilioSignature({
    url,
    params,
    authToken,
    headerSignature,
  });
  if (!ok) {
    // Bad signature — return 403 with a TwiML body so Twilio doesn't
    // additionally log 12300.
    return new Response(emptyTwimlResponse(), {
      status: 403,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }

  const rawFrom = params.From;
  const rawBody = params.Body;
  if (typeof rawFrom !== "string" || rawFrom.length === 0) {
    return twimlResponse(emptyTwimlResponse());
  }
  if (typeof rawBody !== "string" || rawBody.length === 0) {
    return twimlResponse(emptyTwimlResponse());
  }

  if (!smsInboundBucket.tryConsume(rawFrom)) {
    return twimlResponse(emptyTwimlResponse());
  }

  try {
    const result = await handleInboundMessage({
      channel: "sms",
      from: rawFrom,
      body: rawBody,
    });

    // Diagnostic logging for production: which TwiML branch did we
    // emit, and (if Message) does the body length look right? Helps
    // distinguish "we sent a reply but Twilio dropped it" (A2P 10DLC
    // filtering on US carriers) from "our pipeline didn't produce a
    // reply" (no office match for this number, or AI flagged the
    // message). The body length is logged, NOT the body itself —
    // keeps the office name and phone out of plaintext logs.
    if (
      result.status === "received" &&
      typeof result.smsAutoReplyBody === "string" &&
      result.smsAutoReplyBody.length > 0
    ) {
      // eslint-disable-next-line no-console
      console.log(
        `[sms-inbound] status=received reply=Message bodyLen=${result.smsAutoReplyBody.length} requestId=${result.requestId}`,
      );
      return twimlResponse(messageTwimlResponse(result.smsAutoReplyBody));
    }
    // unknown_sender / flagged / received-without-body / error → empty
    // TwiML. The Content-Type is what kills Twilio error 12300; an
    // empty <Response> still satisfies that.
    // eslint-disable-next-line no-console
    console.log(
      `[sms-inbound] status=${result.status} reply=empty (no auto-reply for this branch)`,
    );
    return twimlResponse(emptyTwimlResponse());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("inbound SMS route error", err);
    return twimlResponse(emptyTwimlResponse());
  }
}
