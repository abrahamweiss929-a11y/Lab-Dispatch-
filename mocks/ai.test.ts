import { describe, it, expect } from "vitest";
import { aiMock } from "./ai";

describe("aiMock.parsePickupMessage", () => {
  it("parses STAT urgency with a sample count", async () => {
    const result = await aiMock.parsePickupMessage({
      channel: "sms",
      from: "+15551234567",
      body: "3 samples, STAT",
    });
    expect(result.urgency).toBe("stat");
    expect(result.sampleCount).toBe(3);
    expect(result.specialInstructions).toBeUndefined();
    expect(result.confidence).toBe(0.9);
  });

  it("parses routine body with special instructions after a newline", async () => {
    const result = await aiMock.parsePickupMessage({
      channel: "email",
      from: "doc@example.com",
      body: "morning pickup please\nleave at back door",
    });
    expect(result.urgency).toBe("routine");
    expect(result.specialInstructions).toBe("leave at back door");
    // no sample count, non-inferred urgency -> 0.9 - 0.2 - 0.2 = 0.5
    expect(result.confidence).toBe(0.5);
  });

  it("empty body defaults to routine and floors confidence at 0.5", async () => {
    const result = await aiMock.parsePickupMessage({
      channel: "web",
      from: "x@example.com",
      body: "",
    });
    expect(result.urgency).toBe("routine");
    expect(result.sampleCount).toBeUndefined();
    expect(result.specialInstructions).toBeUndefined();
    expect(result.confidence).toBe(0.5);
  });

  it("detects urgent/asap/rush as urgent", async () => {
    const asap = await aiMock.parsePickupMessage({
      channel: "sms",
      from: "+1",
      body: "please asap 2 tubes",
    });
    expect(asap.urgency).toBe("urgent");
    expect(asap.sampleCount).toBe(2);
    expect(asap.confidence).toBe(0.9);
  });
});
