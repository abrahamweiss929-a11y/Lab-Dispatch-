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
      textBody: "your pickup is scheduled",
    });
    expect(result.messageId).toMatch(/^email-mock-/);

    const sent = getSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("doc@example.com");
    expect(sent[0]?.subject).toBe("pickup confirmation");
    expect(sent[0]?.textBody).toBe("your pickup is scheduled");
    expect(typeof sent[0]?.sentAt).toBe("string");
  });

  it("preserves htmlBody, fromName, and replyTo when supplied", async () => {
    await emailMock.sendEmail({
      to: "doc@example.com",
      subject: "pickup confirmation",
      textBody: "plain",
      htmlBody: "<p>html</p>",
      fromName: "Lab Dispatch",
      replyTo: "ops@labdispatch.app",
    });
    const sent = getSentEmails();
    expect(sent[0]?.htmlBody).toBe("<p>html</p>");
    expect(sent[0]?.fromName).toBe("Lab Dispatch");
    expect(sent[0]?.replyTo).toBe("ops@labdispatch.app");
  });

  it("produces deterministic sequential ids and resets counter", async () => {
    const a = await emailMock.sendEmail({
      to: "a@example.com",
      subject: "x",
      textBody: "y",
    });
    const b = await emailMock.sendEmail({
      to: "b@example.com",
      subject: "x",
      textBody: "y",
    });
    expect(a.messageId).toBe("email-mock-0");
    expect(b.messageId).toBe("email-mock-1");

    resetEmailMock();
    expect(getSentEmails()).toHaveLength(0);

    const afterReset = await emailMock.sendEmail({
      to: "c@example.com",
      subject: "x",
      textBody: "y",
    });
    expect(afterReset.messageId).toBe("email-mock-0");
  });

  it("allows empty subject but rejects empty to", async () => {
    const result = await emailMock.sendEmail({
      to: "x@example.com",
      subject: "",
      textBody: "no subject here",
    });
    expect(result.messageId).toBe("email-mock-0");

    await expect(
      emailMock.sendEmail({ to: "", subject: "hi", textBody: "hi" }),
    ).rejects.toThrow(/to is required/);
  });
});
