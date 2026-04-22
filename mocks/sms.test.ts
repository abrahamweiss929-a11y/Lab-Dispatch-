import { describe, it, expect, beforeEach } from "vitest";
import { smsMock, getSent, resetSmsMock } from "./sms";

describe("smsMock", () => {
  beforeEach(() => {
    resetSmsMock();
  });

  it("queues an sms and records it in getSent()", async () => {
    const result = await smsMock.sendSms({
      to: "+15551234567",
      body: "hi",
    });
    expect(result.id).toMatch(/^sms-mock-/);
    expect(result.status).toBe("queued");

    const sent = getSent();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("+15551234567");
    expect(sent[0]?.body).toBe("hi");
    expect(typeof sent[0]?.sentAt).toBe("string");
  });

  it("produces deterministic sequential ids and resetSmsMock() rewinds the counter", async () => {
    const first = await smsMock.sendSms({ to: "+15551234567", body: "a" });
    const second = await smsMock.sendSms({ to: "+15551234567", body: "b" });
    expect(first.id).toBe("sms-mock-0");
    expect(second.id).toBe("sms-mock-1");
    expect(getSent()).toHaveLength(2);

    resetSmsMock();
    expect(getSent()).toHaveLength(0);

    const afterReset = await smsMock.sendSms({ to: "+15551234567", body: "c" });
    expect(afterReset.id).toBe("sms-mock-0");
  });
});
