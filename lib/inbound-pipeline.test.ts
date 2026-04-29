import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleInboundMessage } from "./inbound-pipeline";
import { resetAllMocks } from "@/interfaces";
import { storageMock } from "@/mocks/storage";
import { aiMock } from "@/mocks/ai";
import { getSent } from "@/mocks/sms";
import { getSentEmails } from "@/mocks/email";
import type { OfficeAddress } from "@/lib/types";

const ADDRESS: OfficeAddress = {
  street: "100 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

async function seedOffice(
  overrides: Partial<{
    phone?: string;
    email?: string;
    active: boolean;
    name: string;
    slug: string;
    pickupUrlToken: string;
  }> = {},
) {
  return storageMock.createOffice({
    name: overrides.name ?? "Acme Clinic",
    slug: overrides.slug ?? "acme-clinic",
    pickupUrlToken: overrides.pickupUrlToken ?? "a1b2c3d4e5f6",
    address: ADDRESS,
    active: overrides.active ?? true,
    phone: overrides.phone,
    email: overrides.email,
  });
}

describe("handleInboundMessage", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("unknown SMS sender: stores the message, sends the brush-off, creates no request", async () => {
    const result = await handleInboundMessage({
      channel: "sms",
      from: "+15550001111",
      body: "pickup please",
    });

    expect(result.status).toBe("unknown_sender");

    const messages = await storageMock.listMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.channel).toBe("sms");
    expect(messages[0]?.fromIdentifier).toBe("+15550001111");
    expect(messages[0]?.pickupRequestId).toBeUndefined();

    const sms = getSent();
    expect(sms).toHaveLength(1);
    expect(sms[0]?.to).toBe("+15550001111");
    expect(sms[0]?.body).toMatch(/isn't set up for pickups yet/);

    expect(await storageMock.listPickupRequests()).toHaveLength(0);
  });

  it("unknown email sender: stores lowercased/trimmed address and auto-replies", async () => {
    const result = await handleInboundMessage({
      channel: "email",
      from: "  Unknown@Random.Test  ",
      subject: "Pickup?",
      body: "Please help",
    });

    expect(result.status).toBe("unknown_sender");

    const messages = await storageMock.listMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.fromIdentifier).toBe("unknown@random.test");

    const emails = getSentEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toBe("unknown@random.test");
    expect(emails[0]?.subject).toBe("Re: Pickup?");
    expect(emails[0]?.textBody).toMatch(/isn't set up for pickups yet/);
  });

  it("unknown SMS sender with unparseable from: stores raw, sends no SMS", async () => {
    const result = await handleInboundMessage({
      channel: "sms",
      from: "not-a-phone",
      body: "pickup please",
    });

    expect(result.status).toBe("unknown_sender");

    const messages = await storageMock.listMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.fromIdentifier).toBe("not-a-phone");

    expect(getSent()).toHaveLength(0);
    expect(await storageMock.listPickupRequests()).toHaveLength(0);
  });

  it("low confidence: creates a flagged pickup request, sends NO auto-reply (post-2026-04-29 policy)", async () => {
    // Updated policy: flagged requests get no automatic confirmation —
    // dispatcher reviews before any sender-facing reply. Avoids
    // confirming a bad parse to the sender.
    const office = await seedOffice({ phone: "+15550002222" });
    vi.spyOn(aiMock, "parsePickupMessage").mockResolvedValueOnce({
      confidence: 0.4,
      urgency: "routine",
    });

    const result = await handleInboundMessage({
      channel: "sms",
      from: "+15550002222",
      body: "not sure",
    });

    expect(result.status).toBe("flagged");

    const requests = await storageMock.listPickupRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.status).toBe("flagged");
    expect(requests[0]?.flaggedReason).toBe("ai_low_confidence");
    expect(requests[0]?.officeId).toBe(office.id);
    expect(requests[0]?.sourceIdentifier).toBe("+15550002222");

    const messages = await storageMock.listMessages();
    expect(messages[0]?.pickupRequestId).toBe(requests[0]?.id);

    // No auto-reply sent for flagged requests.
    expect(getSent()).toHaveLength(0);
  });

  it("high confidence: creates pending request and sends auto-confirmation SMS naming the office", async () => {
    await seedOffice({
      name: "Acme Clinic",
      phone: "+15550002222",
    });
    vi.spyOn(aiMock, "parsePickupMessage").mockResolvedValueOnce({
      confidence: 0.9,
      urgency: "urgent",
      sampleCount: 3,
      specialInstructions: "fridge",
    });

    const result = await handleInboundMessage({
      channel: "sms",
      from: "+15550002222",
      body: "urgent 3 samples in fridge",
    });

    expect(result.status).toBe("received");

    const requests = await storageMock.listPickupRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.status).toBe("pending");
    expect(requests[0]?.urgency).toBe("urgent");
    expect(requests[0]?.sampleCount).toBe(3);
    expect(requests[0]?.specialInstructions).toBe("fridge");

    const messages = await storageMock.listMessages();
    expect(messages[0]?.pickupRequestId).toBe(requests[0]?.id);

    const sms = getSent();
    expect(sms).toHaveLength(1);
    expect(sms[0]?.body).toContain("Acme Clinic");
    expect(sms[0]?.body).toContain("Lab Dispatch:");
    expect(sms[0]?.body).toMatch(/driver will be assigned/i);
  });

  it("email happy path: lowercased to, auto-confirmation subject + office name in body", async () => {
    await seedOffice({
      name: "Acme Clinic",
      email: "front-desk@acme.test",
    });
    vi.spyOn(aiMock, "parsePickupMessage").mockResolvedValueOnce({
      confidence: 0.9,
      urgency: "routine",
      sampleCount: 2,
    });

    const result = await handleInboundMessage({
      channel: "email",
      from: "Front-Desk@Acme.Test",
      subject: "Pickup today",
      body: "2 samples please",
    });

    expect(result.status).toBe("received");
    const emails = getSentEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toBe("front-desk@acme.test");
    expect(emails[0]?.subject).toBe("Pickup request received — Lab Dispatch");
    expect(emails[0]?.textBody).toContain("Acme Clinic");
    expect(emails[0]?.textBody).toMatch(/driver will be assigned/i);
    expect(getSent()).toHaveLength(0);
  });

  it("pipeline error after message stored: swallows, returns error, no auto-reply", async () => {
    await seedOffice({ phone: "+15550002222" });
    vi.spyOn(storageMock, "createPickupRequest").mockRejectedValueOnce(
      new Error("boom"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await handleInboundMessage({
      channel: "sms",
      from: "+15550002222",
      body: "hello",
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.messageId).toBeTruthy();
    }

    // Message row persisted.
    const messages = await storageMock.listMessages();
    expect(messages).toHaveLength(1);
    // No auto-reply.
    expect(getSent()).toHaveLength(0);
    // No pickup request created.
    expect(await storageMock.listPickupRequests()).toHaveLength(0);

    errorSpy.mockRestore();
  });
});
