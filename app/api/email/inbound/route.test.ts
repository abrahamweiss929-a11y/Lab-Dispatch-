import { describe, it, expect, vi, beforeEach } from "vitest";

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

function jsonRequest(payload: unknown): Request {
  return new Request("https://example.test/api/email/inbound", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/email/inbound", () => {
  beforeEach(() => {
    handleInboundMessageMock.mockReset();
    tryConsumeMock.mockReset();
    tryConsumeMock.mockReturnValue(true);
  });

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
    const req = new Request("https://example.test/api/email/inbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
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
