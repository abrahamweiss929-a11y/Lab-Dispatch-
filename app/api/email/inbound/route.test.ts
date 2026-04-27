import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleInboundMessageMock = vi.fn<[unknown], unknown>();
const tryConsumeMock = vi.fn<[string], boolean>(() => true);

vi.mock("@/lib/inbound-pipeline", () => ({
  handleInboundMessage: (arg: unknown) => handleInboundMessageMock(arg),
}));

vi.mock("@/lib/inbound-rate-limits", () => ({
  emailInboundBucket: {
    tryConsume: (key: string) => tryConsumeMock(key),
  },
}));

import { POST } from "./route";

const TEST_TOKEN = "test-secret-abc-123";
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, POSTMARK_INBOUND_WEBHOOK_TOKEN: TEST_TOKEN };
  handleInboundMessageMock.mockReset();
  tryConsumeMock.mockReset();
  tryConsumeMock.mockReturnValue(true);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function jsonRequest(payload: unknown, token: string | null = TEST_TOKEN): Request {
  const url =
    token === null
      ? "https://example.test/api/email/inbound"
      : `https://example.test/api/email/inbound?token=${encodeURIComponent(token)}`;
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/email/inbound — auth", () => {
  it("returns 401 when ?token is missing", async () => {
    const res = await POST(jsonRequest({ From: "x@y.com", TextBody: "hi" }, null));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ status: "invalid_signature" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns 401 when ?token is wrong", async () => {
    const res = await POST(
      jsonRequest({ From: "x@y.com", TextBody: "hi" }, "wrong-token"),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ status: "invalid_signature" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns 401 (fail-closed) when POSTMARK_INBOUND_WEBHOOK_TOKEN env is unset", async () => {
    delete process.env.POSTMARK_INBOUND_WEBHOOK_TOKEN;
    const res = await POST(jsonRequest({ From: "x@y.com", TextBody: "hi" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ status: "invalid_signature" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/email/inbound — happy path", () => {
  it("happy: parses JSON body, calls pipeline with TextBody, returns 200 with result", async () => {
    handleInboundMessageMock.mockResolvedValueOnce({
      status: "received",
      requestId: "req-1",
      messageId: "msg-1",
    });

    const res = await POST(
      jsonRequest({
        From: "front-desk@acme.test",
        Subject: "Pickup",
        TextBody: "2 samples please",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "received",
      requestId: "req-1",
      messageId: "msg-1",
    });
    expect(handleInboundMessageMock).toHaveBeenCalledWith({
      channel: "email",
      from: "front-desk@acme.test",
      subject: "Pickup",
      body: "2 samples please",
    });
  });

  it("uses FromFull.Email over From when both present (parser preference)", async () => {
    handleInboundMessageMock.mockResolvedValueOnce({
      status: "received",
      requestId: "r",
      messageId: "m",
    });

    await POST(
      jsonRequest({
        From: "John Doe <john@acme.test>",
        FromFull: { Email: "john@acme.test", Name: "John Doe" },
        TextBody: "hi",
      }),
    );

    expect(handleInboundMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "john@acme.test" }),
    );
  });

  it("falls back to HtmlBody when TextBody is absent", async () => {
    handleInboundMessageMock.mockResolvedValueOnce({
      status: "received",
      requestId: "req-1",
      messageId: "msg-1",
    });

    await POST(
      jsonRequest({
        From: "front-desk@acme.test",
        HtmlBody: "<p>please</p>",
      }),
    );

    expect(handleInboundMessageMock).toHaveBeenCalledWith({
      channel: "email",
      from: "front-desk@acme.test",
      subject: undefined,
      body: "<p>please</p>",
    });
  });

  it("returns invalid_payload when both TextBody and HtmlBody are missing", async () => {
    const res = await POST(
      jsonRequest({
        From: "front-desk@acme.test",
        Subject: "Pickup",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "invalid_payload" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns invalid_payload when From is missing", async () => {
    const res = await POST(jsonRequest({ TextBody: "hi" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "invalid_payload" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns invalid_payload when the body is not JSON", async () => {
    const req = new Request(
      `https://example.test/api/email/inbound?token=${TEST_TOKEN}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "invalid_payload" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns rate_limited when the bucket denies, pipeline not called", async () => {
    tryConsumeMock.mockReturnValueOnce(false);
    const res = await POST(
      jsonRequest({
        From: "front-desk@acme.test",
        TextBody: "2 samples please",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "rate_limited" });
    expect(handleInboundMessageMock).not.toHaveBeenCalled();
  });

  it("returns status error when the pipeline throws", async () => {
    handleInboundMessageMock.mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      jsonRequest({
        From: "front-desk@acme.test",
        TextBody: "2 samples please",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "error" });

    errorSpy.mockRestore();
  });
});
