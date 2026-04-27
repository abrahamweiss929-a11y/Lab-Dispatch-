import { NextResponse } from "next/server";
import { handleInboundMessage } from "@/lib/inbound-pipeline";
import { emailInboundBucket } from "@/lib/inbound-rate-limits";

interface EmailWebhookBody {
  From?: unknown;
  Subject?: unknown;
  TextBody?: unknown;
  HtmlBody?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// PUBLIC endpoint — deliberately NO session check. The `/api/` prefix is
// in `PUBLIC_PATH_PREFIXES` (lib/auth-rules.ts) and this route has no
// auth gate of its own. `emailInboundBucket` is the only abuse guard.
// TODO(blockers:postmark) — real Postmark signature / secret-path
// verification belongs here. Until then, any client that can reach this
// URL can post inbound email payloads. See BLOCKERS.md [postmark].
export async function POST(req: Request): Promise<Response> {
  let parsed: EmailWebhookBody;
  try {
    parsed = (await req.json()) as EmailWebhookBody;
  } catch {
    return NextResponse.json({ status: "invalid_payload" }, { status: 200 });
  }

  const from = asString(parsed.From);
  const subject = asString(parsed.Subject);
  const textBody = asString(parsed.TextBody);
  const htmlBody = asString(parsed.HtmlBody);
  const body = textBody ?? htmlBody;

  if (from === undefined || body === undefined) {
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
