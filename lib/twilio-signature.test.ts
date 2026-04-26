import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeTwilioSignature,
  reconstructWebhookUrl,
  verifyTwilioSignature,
} from "./twilio-signature";

const AUTH_TOKEN = "test-auth-token-1234567890abcdef";

function expectedSig(url: string, params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  let payload = url;
  for (const k of keys) payload += k + params[k];
  return createHmac("sha1", AUTH_TOKEN).update(payload, "utf8").digest("base64");
}

describe("computeTwilioSignature", () => {
  it("matches the textbook Twilio algorithm: URL + sorted key+value pairs, HMAC-SHA1, base64", () => {
    const url = "https://example.com/api/sms/inbound";
    const params = {
      From: "+15551234567",
      To: "+15559876543",
      Body: "hello world",
      MessageSid: "SM123",
    };
    const sig = computeTwilioSignature(url, params, AUTH_TOKEN);
    expect(sig).toBe(expectedSig(url, params));
  });

  it("is sensitive to URL changes (signature changes if URL differs)", () => {
    const params = { From: "+15551234567", Body: "hi" };
    const a = computeTwilioSignature(
      "https://example.com/a",
      params,
      AUTH_TOKEN,
    );
    const b = computeTwilioSignature(
      "https://example.com/b",
      params,
      AUTH_TOKEN,
    );
    expect(a).not.toBe(b);
  });

  it("is sensitive to body parameter changes", () => {
    const url = "https://example.com/api/sms/inbound";
    const a = computeTwilioSignature(url, { From: "+1", Body: "hi" }, AUTH_TOKEN);
    const b = computeTwilioSignature(url, { From: "+1", Body: "bye" }, AUTH_TOKEN);
    expect(a).not.toBe(b);
  });

  it("orders params alphabetically regardless of insertion order", () => {
    const url = "https://example.com/x";
    const a = computeTwilioSignature(
      url,
      { Zeta: "z", Alpha: "a", Mu: "m" },
      AUTH_TOKEN,
    );
    const b = computeTwilioSignature(
      url,
      { Mu: "m", Alpha: "a", Zeta: "z" },
      AUTH_TOKEN,
    );
    expect(a).toBe(b);
  });
});

describe("verifyTwilioSignature", () => {
  const url = "https://example.com/api/sms/inbound";
  const params = { From: "+15551234567", Body: "hi", MessageSid: "SM1" };

  it("accepts a correct signature", () => {
    const sig = computeTwilioSignature(url, params, AUTH_TOKEN);
    expect(
      verifyTwilioSignature({
        url,
        params,
        authToken: AUTH_TOKEN,
        headerSignature: sig,
      }),
    ).toBe(true);
  });

  it("rejects when the header is missing or empty", () => {
    expect(
      verifyTwilioSignature({
        url,
        params,
        authToken: AUTH_TOKEN,
        headerSignature: null,
      }),
    ).toBe(false);
    expect(
      verifyTwilioSignature({
        url,
        params,
        authToken: AUTH_TOKEN,
        headerSignature: "",
      }),
    ).toBe(false);
    expect(
      verifyTwilioSignature({
        url,
        params,
        authToken: AUTH_TOKEN,
        headerSignature: undefined,
      }),
    ).toBe(false);
  });

  it("rejects when the body is tampered with", () => {
    const sig = computeTwilioSignature(url, params, AUTH_TOKEN);
    expect(
      verifyTwilioSignature({
        url,
        params: { ...params, Body: "tampered" },
        authToken: AUTH_TOKEN,
        headerSignature: sig,
      }),
    ).toBe(false);
  });

  it("rejects when the auth token is wrong", () => {
    const sig = computeTwilioSignature(url, params, AUTH_TOKEN);
    expect(
      verifyTwilioSignature({
        url,
        params,
        authToken: "different-token",
        headerSignature: sig,
      }),
    ).toBe(false);
  });

  it("rejects when the signature is the wrong length", () => {
    expect(
      verifyTwilioSignature({
        url,
        params,
        authToken: AUTH_TOKEN,
        headerSignature: "tooshort",
      }),
    ).toBe(false);
  });
});

describe("reconstructWebhookUrl", () => {
  it("returns the request URL when no proxy headers are set", () => {
    const req = new Request("https://example.com/api/sms/inbound", {
      method: "POST",
    });
    expect(reconstructWebhookUrl(req)).toBe(
      "https://example.com/api/sms/inbound",
    );
  });

  it("honors x-forwarded-proto and x-forwarded-host", () => {
    const req = new Request("http://internal.local/api/sms/inbound", {
      method: "POST",
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "lab-dispatch.example.com",
      },
    });
    expect(reconstructWebhookUrl(req)).toBe(
      "https://lab-dispatch.example.com/api/sms/inbound",
    );
  });

  it("preserves the query string", () => {
    const req = new Request(
      "https://example.com/api/sms/inbound?debug=1",
      { method: "POST" },
    );
    expect(reconstructWebhookUrl(req)).toBe(
      "https://example.com/api/sms/inbound?debug=1",
    );
  });
});
