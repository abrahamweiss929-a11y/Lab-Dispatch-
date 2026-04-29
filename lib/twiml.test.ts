import { describe, expect, it } from "vitest";
import {
  emptyTwimlResponse,
  messageTwimlResponse,
  twimlResponse,
} from "./twiml";

describe("emptyTwimlResponse", () => {
  it("returns a well-formed empty Response document", () => {
    expect(emptyTwimlResponse()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    );
  });
});

describe("messageTwimlResponse", () => {
  it("wraps the body in <Message>", () => {
    const xml = messageTwimlResponse("Lab Dispatch: pickup received.");
    expect(xml).toContain("<Response><Message>");
    expect(xml).toContain("</Message></Response>");
    expect(xml).toContain("Lab Dispatch: pickup received.");
  });

  it("escapes XML special chars", () => {
    const xml = messageTwimlResponse("a & b < c > d \"q\" 'a'");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&gt;");
    expect(xml).toContain("&quot;");
    expect(xml).toContain("&apos;");
    // No raw `&` or `<` in the body slice
    expect(xml).not.toMatch(/[^&]& /);
  });
});

describe("twimlResponse", () => {
  it("returns 200 with text/xml Content-Type", async () => {
    const r = twimlResponse(emptyTwimlResponse());
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/xml");
    const text = await r.text();
    expect(text).toContain("<Response");
  });
});
