import { NextResponse } from "next/server";
import { handleInboundMessage } from "@/lib/inbound-pipeline";
import { smsInboundBucket } from "@/lib/inbound-rate-limits";
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
    return NextResponse.json({ status: "invalid_payload" }, { status: 400 });
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
    return NextResponse.json(
      { status: "invalid_signature" },
      { status: 403 },
    );
  }

  const rawFrom = params.From;
  const rawBody = params.Body;
  if (typeof rawFrom !== "string" || rawFrom.length === 0) {
    return NextResponse.json({ status: "invalid_payload" }, { status: 200 });
  }
  if (typeof rawBody !== "string" || rawBody.length === 0) {
    return NextResponse.json({ status: "invalid_payload" }, { status: 200 });
  }

  if (!smsInboundBucket.tryConsume(rawFrom)) {
    return NextResponse.json({ status: "rate_limited" }, { status: 200 });
  }

  try {
    const result = await handleInboundMessage({
      channel: "sms",
      from: rawFrom,
      body: rawBody,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("inbound SMS route error", err);
    return NextResponse.json({ status: "error" }, { status: 200 });
  }
}
