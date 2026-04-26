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

  it("happy: valid signature, parses form body, calls pipeline, returns 200 with result", async () => {
    handleInboundMessageMock.mockResolvedValueOnce({
      status: "received",
      requestId: "req-1",
      messageId: "msg-1",
    });

    const res = await POST(
      formRequest({ From: "+15550001111", Body: "pickup please" }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      status: "received",
      requestId: "req-1",
      messageId: "msg-1",
    });
    expect(handleInboundMessageMock).toHaveBeenCalledWith({
      channel: "sms",
      from: "+15550001111",
      body: "pickup please",
    });
  });

  it("returns 403 invalid_signature when the X-Twilio-Signature header is missing", async () => {
    const res = await POST(
      formRequest(
        { From: "+15550001111", Body: "pickup please" },
        { signed: false },
      ),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: "invalid_signature" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns 403 invalid_signature when the signature is wrong", async () => {
    const res = await POST(
      formRequest(
        { From: "+15550001111", Body: "pickup please" },
        { signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
      ),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ status: "invalid_signature" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the body is tampered with after signing", async () => {
    // Sign one body, then submit a different body with the same signature.
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
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns 503 not_configured when TWILIO_AUTH_TOKEN is unset", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      formRequest(
        { From: "+15550001111", Body: "hi" },
        { signed: false },
      ),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "not_configured" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("returns invalid_payload when Body is missing", async () => {
    const res = await POST(formRequest({ From: "+15550001111" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "invalid_payload" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns invalid_payload when From is missing", async () => {
    const res = await POST(formRequest({ Body: "hi" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "invalid_payload" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns rate_limited when the bucket denies, pipeline not called", async () => {
    tryConsumeMock.mockReturnValueOnce(false);
    const res = await POST(
      formRequest({ From: "+15550001111", Body: "pickup please" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "rate_limited" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns status error when the pipeline throws (no uncaught reject)", async () => {
    handleInboundMessageMock.mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      formRequest({ From: "+15550001111", Body: "pickup please" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "error" });

    errorSpy.mockRestore();
  });
});
