import { NextResponse } from "next/server";
import {
  parseInboundWebhook,
  verifyInboundSignature,
} from "@/interfaces/email";
import { handleInboundMessage } from "@/lib/inbound-pipeline";
import { emailInboundBucket } from "@/lib/inbound-rate-limits";

// PUBLIC endpoint — no session check. Authenticity is enforced by the
// `?token=` query parameter, which must match `POSTMARK_INBOUND_WEBHOOK_TOKEN`
// (constant-time compared in `verifyInboundSignature`). Requests without
// a valid token are rejected with 401. `emailInboundBucket` adds per-
// sender abuse protection on top.
//
// Postmark sends inbound webhooks as JSON. Postmark's authenticity model
// is "secret token in the webhook URL" rather than HMAC-over-body, so the
// verifier reads `?token=` from the URL and compares to the env var. When
// the env var is unset the verifier returns false (fail-closed) — we'd
// rather drop messages than accept unsigned ones.
export async function POST(req: Request): Promise<Response> {
  if (!verifyInboundSignature(req)) {
    return NextResponse.json(
      { status: "invalid_signature" },
      { status: 401 },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = await req.json();
  } catch {
    return NextResponse.json({ status: "invalid_payload" }, { status: 200 });
  }

  const inbound = parseInboundWebhook(parsedJson);
  const from = inbound.fromEmail;
  const body =
    inbound.bodyText.length > 0 ? inbound.bodyText : inbound.bodyHtml;
  const subject = inbound.subject.length > 0 ? inbound.subject : undefined;

  if (from.length === 0 || body.length === 0) {
    return NextResponse.json({ status: "invalid_payload" }, { status: 200 });
  }

  if (!emailInboundBucket.tryConsume(from)) {
    return NextResponse.json({ status: "rate_limited" }, { status: 200 });
  }

  try {
    const result = await handleInboundMessage({
      channel: "email",
      from,
      subject,
      body,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("inbound email route error", err);
    return NextResponse.json({ status: "error" }, { status: 200 });
  }
}

// Health probe for Postmark's webhook URL validator. Postmark pings
// the inbound URL with a GET before it'll save the configuration; the
// default 405 from Next.js made it refuse the URL. Plain 200 + an
// `endpoint` tag so this is identifiable in logs but exposes no
// sensitive information.
export async function GET() {
  return new Response(
    JSON.stringify({ status: "ok", endpoint: "email-inbound" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
