import { describe, it, expect, beforeEach } from "vitest";
import { emailMock, getSentEmails, resetEmailMock } from "./email";

describe("emailMock", () => {
  beforeEach(() => {
    resetEmailMock();
  });

  it("queues an email and records it in getSentEmails()", async () => {
    const result = await emailMock.sendEmail({
      to: "doc@example.com",
      subject: "pickup confirmation",
      body: "your pickup is scheduled",
    });
    expect(result.id).toMatch(/^email-mock-/);

    const sent = getSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("doc@example.com");
    expect(sent[0]?.subject).toBe("pickup confirmation");
    expect(sent[0]?.body).toBe("your pickup is scheduled");
    expect(typeof sent[0]?.sentAt).toBe("string");
  });

  it("produces deterministic sequential ids and resets counter", async () => {
    const a = await emailMock.sendEmail({
      to: "a@example.com",
      subject: "x",
      body: "y",
    });
    const b = await emailMock.sendEmail({
      to: "b@example.com",
      subject: "x",
      body: "y",
    });
    expect(a.id).toBe("email-mock-0");
    expect(b.id).toBe("email-mock-1");

    resetEmailMock();
    expect(getSentEmails()).toHaveLength(0);

    const afterReset = await emailMock.sendEmail({
      to: "c@example.com",
      subject: "x",
      body: "y",
    });
    expect(afterReset.id).toBe("email-mock-0");
  });

  it("allows empty subject but rejects empty to", async () => {
    const result = await emailMock.sendEmail({
      to: "x@example.com",
      subject: "",
      body: "no subject here",
    });
    expect(result.id).toBe("email-mock-0");

    await expect(
      emailMock.sendEmail({ to: "", subject: "hi", body: "hi" }),
    ).rejects.toThrow(/to is required/);
  });
});
