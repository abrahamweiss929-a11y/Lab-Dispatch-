import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRealEmailService,
  formatFrom,
  parseInboundWebhook,
  verifyInboundSignature,
} from "./email";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ---------- formatFrom ------------------------------------------------------

describe("formatFrom", () => {
  it("returns bare email when no fromName", () => {
    expect(formatFrom("a@b.com")).toBe("a@b.com");
    expect(formatFrom("a@b.com", undefined)).toBe("a@b.com");
    expect(formatFrom("a@b.com", "")).toBe("a@b.com");
    expect(formatFrom("a@b.com", "   ")).toBe("a@b.com");
  });

  it("prepends quoted name when fromName is set", () => {
    expect(formatFrom("a@b.com", "Lab Dispatch")).toBe(
      "Lab Dispatch <a@b.com>",
    );
  });

  it("trims whitespace from fromName", () => {
    expect(formatFrom("a@b.com", "  Lab  ")).toBe("Lab <a@b.com>");
  });
});

// ---------- parseInboundWebhook ---------------------------------------------

describe("parseInboundWebhook", () => {
  it("prefers FromFull.Email over From", () => {
    const out = parseInboundWebhook({
      From: "Doe <bad@example.com>",
      FromFull: { Email: "good@example.com", Name: "John Doe" },
      Subject: "hi",
      TextBody: "body",
      HtmlBody: "<p>body</p>",
      MessageID: "abc-123",
    });
    expect(out.fromEmail).toBe("good@example.com");
    expect(out.fromName).toBe("John Doe");
    expect(out.subject).toBe("hi");
    expect(out.bodyText).toBe("body");
    expect(out.bodyHtml).toBe("<p>body</p>");
    expect(out.messageId).toBe("abc-123");
  });

  it("falls back to extracting bare email from From angle brackets", () => {
    const out = parseInboundWebhook({
      From: "John Doe <john@example.com>",
      FromName: "John Doe",
      Subject: "hi",
      TextBody: "body",
    });
    expect(out.fromEmail).toBe("john@example.com");
    expect(out.fromName).toBe("John Doe");
  });

  it("treats a plain From email as the bare email", () => {
    const out = parseInboundWebhook({
      From: "plain@example.com",
      Subject: "x",
    });
    expect(out.fromEmail).toBe("plain@example.com");
    expect(out.fromName).toBe("");
  });

  it("returns empty strings when the payload is missing or wrong type", () => {
    const out1 = parseInboundWebhook(null);
    expect(out1.fromEmail).toBe("");
    expect(out1.subject).toBe("");
    expect(out1.bodyText).toBe("");
    expect(out1.bodyHtml).toBe("");
    expect(out1.messageId).toBe("");

    const out2 = parseInboundWebhook("not an object");
    expect(out2.fromEmail).toBe("");
  });

  it("ignores wrong-typed FromFull", () => {
    const out = parseInboundWebhook({
      From: "back@example.com",
      FromFull: "not an object",
      Subject: "hi",
    });
    expect(out.fromEmail).toBe("back@example.com");
  });
});

// ---------- verifyInboundSignature ------------------------------------------

function makeRequest(url: string): Request {
  return new Request(url, { method: "POST" });
}

describe("verifyInboundSignature", () => {
  it("returns true on exact token match", () => {
    process.env.POSTMARK_INBOUND_WEBHOOK_TOKEN = "secret-abc-123";
    expect(
      verifyInboundSignature(
        makeRequest("https://x.test/api/email/inbound?token=secret-abc-123"),
      ),
    ).toBe(true);
  });

  it("returns false on token mismatch", () => {
    process.env.POSTMARK_INBOUND_WEBHOOK_TOKEN = "secret-abc-123";
    expect(
      verifyInboundSignature(
        makeRequest("https://x.test/api/email/inbound?token=wrong-token"),
      ),
    ).toBe(false);
  });

  it("returns false on length-mismatched tokens (without crashing timingSafeEqual)", () => {
    process.env.POSTMARK_INBOUND_WEBHOOK_TOKEN = "secret-abc-123";
    expect(
      verifyInboundSignature(
        makeRequest("https://x.test/api/email/inbound?token=short"),
      ),
    ).toBe(false);
  });

  it("returns false when no token query param", () => {
    process.env.POSTMARK_INBOUND_WEBHOOK_TOKEN = "secret-abc-123";
    expect(
      verifyInboundSignature(
        makeRequest("https://x.test/api/email/inbound"),
      ),
    ).toBe(false);
  });

  it("returns false when token query is empty", () => {
    process.env.POSTMARK_INBOUND_WEBHOOK_TOKEN = "secret-abc-123";
    expect(
      verifyInboundSignature(
        makeRequest("https://x.test/api/email/inbound?token="),
      ),
    ).toBe(false);
  });

  it("fails closed when env var is unset", () => {
    delete process.env.POSTMARK_INBOUND_WEBHOOK_TOKEN;
    expect(
      verifyInboundSignature(
        makeRequest("https://x.test/api/email/inbound?token=anything"),
      ),
    ).toBe(false);
  });

  it("fails closed when env var is empty string", () => {
    process.env.POSTMARK_INBOUND_WEBHOOK_TOKEN = "";
    expect(
      verifyInboundSignature(
        makeRequest("https://x.test/api/email/inbound?token=anything"),
      ),
    ).toBe(false);
  });
});

// ---------- createRealEmailService ------------------------------------------

interface FetchInitShape {
  method: string;
  headers: Record<string, string>;
  body: string;
}

function mockFetchOnce(response: Partial<Response>) {
  const fn = vi.fn<[string, FetchInitShape], Promise<Response>>(
    async () => response as Response,
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("createRealEmailService", () => {
  it("throws NotConfiguredError when POSTMARK_SERVER_TOKEN is missing", async () => {
    delete process.env.POSTMARK_SERVER_TOKEN;
    process.env.POSTMARK_FROM_EMAIL = "noreply@labdispatch.app";
    const svc = createRealEmailService();
    await expect(
      svc.sendEmail({ to: "x@y.com", subject: "s", textBody: "b" }),
    ).rejects.toThrow(/POSTMARK_SERVER_TOKEN/);
  });

  it("throws NotConfiguredError when POSTMARK_FROM_EMAIL is missing", async () => {
    process.env.POSTMARK_SERVER_TOKEN = "tok";
    delete process.env.POSTMARK_FROM_EMAIL;
    const svc = createRealEmailService();
    await expect(
      svc.sendEmail({ to: "x@y.com", subject: "s", textBody: "b" }),
    ).rejects.toThrow(/POSTMARK_FROM_EMAIL/);
  });

  it("POSTs to Postmark with the correct headers and body shape", async () => {
    process.env.POSTMARK_SERVER_TOKEN = "tok-123";
    process.env.POSTMARK_FROM_EMAIL = "noreply@labdispatch.app";
    const fetchFn = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageID: "pm-msg-789" }),
    } as unknown as Response);
    const svc = createRealEmailService();
    const out = await svc.sendEmail({
      to: "doc@example.com",
      subject: "subj",
      textBody: "plain body",
      htmlBody: "<p>html body</p>",
      fromName: "Lab Dispatch",
      replyTo: "ops@labdispatch.app",
    });
    expect(out.messageId).toBe("pm-msg-789");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Postmark-Server-Token"]).toBe("tok-123");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["Accept"]).toBe("application/json");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.From).toBe("Lab Dispatch <noreply@labdispatch.app>");
    expect(sentBody.To).toBe("doc@example.com");
    expect(sentBody.Subject).toBe("subj");
    expect(sentBody.TextBody).toBe("plain body");
    expect(sentBody.HtmlBody).toBe("<p>html body</p>");
    expect(sentBody.ReplyTo).toBe("ops@labdispatch.app");
  });

  it("omits HtmlBody and ReplyTo when not provided", async () => {
    process.env.POSTMARK_SERVER_TOKEN = "tok";
    process.env.POSTMARK_FROM_EMAIL = "noreply@x.com";
    const fetchFn = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ MessageID: "id" }),
    } as unknown as Response);
    const svc = createRealEmailService();
    await svc.sendEmail({ to: "a@b.com", subject: "s", textBody: "t" });
    const sentBody = JSON.parse(fetchFn.mock.calls[0]![1].body);
    expect("HtmlBody" in sentBody).toBe(false);
    expect("ReplyTo" in sentBody).toBe(false);
    expect(sentBody.From).toBe("noreply@x.com");
  });

  it("throws when Postmark returns non-2xx", async () => {
    process.env.POSTMARK_SERVER_TOKEN = "tok";
    process.env.POSTMARK_FROM_EMAIL = "noreply@x.com";
    mockFetchOnce({
      ok: false,
      status: 422,
      text: async () => '{"ErrorCode":300,"Message":"Invalid From"}',
    } as unknown as Response);
    const svc = createRealEmailService();
    await expect(
      svc.sendEmail({ to: "x@y.com", subject: "s", textBody: "b" }),
    ).rejects.toThrow(/422.*Invalid From/);
  });

  it("returns empty messageId on a 2xx with malformed JSON shape", async () => {
    process.env.POSTMARK_SERVER_TOKEN = "tok";
    process.env.POSTMARK_FROM_EMAIL = "noreply@x.com";
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ /* no MessageID */ }),
    } as unknown as Response);
    const svc = createRealEmailService();
    const out = await svc.sendEmail({
      to: "x@y.com",
      subject: "s",
      textBody: "b",
    });
    expect(out.messageId).toBe("");
  });
});
