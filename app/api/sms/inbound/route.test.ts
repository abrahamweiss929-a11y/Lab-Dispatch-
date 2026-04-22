import { describe, it, expect, vi, beforeEach } from "vitest";

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

function formRequest(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields).toString();
  return new Request("https://example.test/api/sms/inbound", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("POST /api/sms/inbound", () => {
  beforeEach(() => {
    handleInboundMessageMock.mockReset();
    tryConsumeMock.mockReset();
    tryConsumeMock.mockReturnValue(true);
  });

  it("happy: parses form body, calls pipeline, returns 200 with result", async () => {
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
