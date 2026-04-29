import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeTwilioSignature } from "@/lib/twilio-signature";

const handleInboundMessageMock = vi.fn<[unknown], unknown>();
const tryConsumeMock = vi.fn<[string], boolean>(() => true);

vi.mock("@/lib/inbound-pipeline", () => ({
  handleInboundMessage: (arg: unknown) => handleInboundMessageMock(arg),
}));

vi.mock("@/lib/inbound-rate-limits", () => ({
  smsInboundBucket: {
    tryConsume: (key: string) => tryConsumeMock(key),
  },
}));

import { POST } from "./route";

const AUTH_TOKEN = "test-token-abc123";
const URL_STR = "https://example.test/api/sms/inbound";

function formRequest(
  fields: Record<string, string>,
  options: { signed?: boolean; signature?: string | null } = {},
): Request {
  const body = new URLSearchParams(fields).toString();
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  const signed = options.signed ?? true;
  if (signed) {
    const sig =
      options.signature !== undefined && options.signature !== null
        ? options.signature
        : computeTwilioSignature(URL_STR, fields, AUTH_TOKEN);
    if (sig !== null) headers["x-twilio-signature"] = sig;
  }
  return new Request(URL_STR, {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/sms/inbound", () => {
  const originalToken = process.env.TWILIO_AUTH_TOKEN;

  beforeEach(() => {
    handleInboundMessageMock.mockReset();
    tryConsumeMock.mockReset();
    tryConsumeMock.mockReturnValue(true);
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.TWILIO_AUTH_TOKEN;
    } else {
      process.env.TWILIO_AUTH_TOKEN = originalToken;
    }
  });

  it("happy with smsAutoReplyBody: returns TwiML <Message> + Content-Type text/xml", async () => {
    handleInboundMessageMock.mockResolvedValueOnce({
      status: "received",
      requestId: "req-1",
      messageId: "msg-1",
      smsAutoReplyBody: "Lab Dispatch: pickup request received from Acme.",
    });

    const res = await POST(
      formRequest({ From: "+15550001111", Body: "pickup please" }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const body = await res.text();
    expect(body).toContain("<Response><Message>");
    expect(body).toContain(
      "Lab Dispatch: pickup request received from Acme.",
    );
    expect(body).toContain("</Message></Response>");

    expect(handleInboundMessageMock).toHaveBeenCalledWith({
      channel: "sms",
      from: "+15550001111",
      body: "pickup please",
    });
  });

  it("happy without smsAutoReplyBody (e.g. no auto-reply policy): returns empty TwiML", async () => {
    handleInboundMessageMock.mockResolvedValueOnce({
      status: "received",
      requestId: "req-1",
      messageId: "msg-1",
      // smsAutoReplyBody intentionally absent
    });

    const res = await POST(
      formRequest({ From: "+15550001111", Body: "pickup please" }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const body = await res.text();
    expect(body).toContain("<Response></Response>");
    expect(body).not.toContain("<Message>");
  });

  it("flagged: returns empty TwiML (no auto-reply for flagged senders)", async () => {
    handleInboundMessageMock.mockResolvedValueOnce({
      status: "flagged",
      requestId: "req-1",
      messageId: "msg-1",
    });

    const res = await POST(
      formRequest({ From: "+15550001111", Body: "ambiguous" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(await res.text()).toContain("<Response></Response>");
  });

  it("unknown_sender: returns empty TwiML (no auto-reply, but valid Content-Type)", async () => {
    handleInboundMessageMock.mockResolvedValueOnce({
      status: "unknown_sender",
      messageId: "msg-1",
    });

    const res = await POST(
      formRequest({ From: "+15559998888", Body: "first message" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(await res.text()).toContain("<Response></Response>");
  });

  it("returns 403 with empty TwiML when X-Twilio-Signature is missing", async () => {
    const res = await POST(
      formRequest(
        { From: "+15550001111", Body: "pickup please" },
        { signed: false },
      ),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(await res.text()).toContain("<Response></Response>");
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns 403 with empty TwiML when the signature is wrong", async () => {
    const res = await POST(
      formRequest(
        { From: "+15550001111", Body: "pickup please" },
        { signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
      ),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the body is tampered with after signing", async () => {
    const signedFields = { From: "+15550001111", Body: "pickup please" };
    const sig = computeTwilioSignature(URL_STR, signedFields, AUTH_TOKEN);
    const tamperedBody = new URLSearchParams({
      From: "+15550001111",
      Body: "tampered",
    }).toString();
    const req = new Request(URL_STR, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": sig,
      },
      body: tamperedBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns 503 JSON when TWILIO_AUTH_TOKEN is unset (config error, not Twilio response)", async () => {
    // The 503 path is for ops monitoring; it's not a Twilio webhook
    // response so JSON is fine. Twilio will retry; once configured
    // it'll get TwiML.
    delete process.env.TWILIO_AUTH_TOKEN;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      formRequest(
        { From: "+15550001111", Body: "hi" },
        { signed: false },
      ),
    );
    expect(res.status).toBe(503);
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns empty TwiML when Body is missing", async () => {
    const res = await POST(formRequest({ From: "+15550001111" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(await res.text()).toContain("<Response></Response>");
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns empty TwiML when From is missing", async () => {
    const res = await POST(formRequest({ Body: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(await res.text()).toContain("<Response></Response>");
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns empty TwiML when the bucket denies the rate-limit check", async () => {
    tryConsumeMock.mockReturnValueOnce(false);
    const res = await POST(
      formRequest({ From: "+15550001111", Body: "pickup please" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(await res.text()).toContain("<Response></Response>");
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns empty TwiML when the pipeline throws (no uncaught reject)", async () => {
    handleInboundMessageMock.mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      formRequest({ From: "+15550001111", Body: "pickup please" }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(await res.text()).toContain("<Response></Response>");

    errorSpy.mockRestore();
  });
});
