import { NextResponse } from "next/server";
import { handleInboundMessage } from "@/lib/inbound-pipeline";
import { smsInboundBucket } from "@/lib/inbound-rate-limits";

// PUBLIC endpoint — deliberately NO session check. The `/api/` prefix is
// in `PUBLIC_PATH_PREFIXES` (lib/auth-rules.ts) and this route has no
// auth gate of its own. `smsInboundBucket` is the only abuse guard.
// TODO(blockers:twilio) — real Twilio signature verification belongs
// here. Until then, any client that can reach this URL can post inbound
// SMS payloads. See BLOCKERS.md [twilio].
export async function POST(req: Request): Promise<Response> {
  let from: string;
  let body: string;
  try {
    const form = await req.formData();
    const rawFrom = form.get("From");
    const rawBody = form.get("Body");
    if (typeof rawFrom !== "string" || rawFrom.length === 0) {
      return NextResponse.json({ status: "invalid_payload" }, { status: 200 });
    }
    if (typeof rawBody !== "string" || rawBody.length === 0) {
      return NextResponse.json({ status: "invalid_payload" }, { status: 200 });
    }
    from = rawFrom;
    body = rawBody;
  } catch {
    return NextResponse.json({ status: "invalid_payload" }, { status: 200 });
  }

  if (!smsInboundBucket.tryConsume(from)) {
    return NextResponse.json({ status: "rate_limited" }, { status: 200 });
  }

  try {
    const result = await handleInboundMessage({
      channel: "sms",
      from,
      body,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("inbound SMS route error", err);
    return NextResponse.json({ status: "error" }, { status: 200 });
  }
}
