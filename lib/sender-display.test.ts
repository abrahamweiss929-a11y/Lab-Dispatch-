import { describe, expect, it } from "vitest";
import {
  formatSenderInline,
  resolveSenderDisplay,
  senderDisplayLines,
} from "./sender-display";
import type { Doctor, Office } from "@/lib/types";

const ADDRESS = {
  street: "123 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

const ACME: Office = {
  id: "office-1",
  name: "Acme Clinic",
  slug: "acme",
  pickupUrlToken: "demo-acme-01",
  address: ADDRESS,
  phone: "+15551234567",
  email: "front@acme.test",
  active: true,
};

const DOC_JANE: Doctor = {
  id: "doc-1",
  officeId: "office-1",
  name: "Jane Doe, MD",
  email: "jane@acme.test",
  phone: "+15559998888",
};

describe("resolveSenderDisplay", () => {
  it("matches the office by email (case-insensitive)", () => {
    const out = resolveSenderDisplay("Front@Acme.Test", [ACME], []);
    expect(out.kind).toBe("match");
    if (out.kind !== "match") return;
    expect(out.officeName).toBe("Acme Clinic");
    expect(out.doctorName).toBeUndefined();
    expect(out.address.street).toBe("123 Main St");
  });

  it("matches the office by phone (E.164 normalized)", () => {
    const out = resolveSenderDisplay("(555) 123-4567", [ACME], []);
    expect(out.kind).toBe("match");
    if (out.kind !== "match") return;
    expect(out.officeName).toBe("Acme Clinic");
  });

  it("prefers doctor match over office match (more specific)", () => {
    const out = resolveSenderDisplay("jane@acme.test", [ACME], [DOC_JANE]);
    expect(out.kind).toBe("match");
    if (out.kind !== "match") return;
    expect(out.doctorName).toBe("Jane Doe, MD");
    expect(out.officeName).toBe("Acme Clinic");
  });

  it("returns unknown when nothing matches", () => {
    const out = resolveSenderDisplay("stranger@nowhere.test", [ACME], [DOC_JANE]);
    expect(out.kind).toBe("unknown");
    if (out.kind !== "unknown") return;
    expect(out.raw).toBe("stranger@nowhere.test");
  });

  it("does not match an email against a phone-only office", () => {
    const phoneOnly: Office = { ...ACME, email: undefined };
    const out = resolveSenderDisplay("front@acme.test", [phoneOnly], []);
    expect(out.kind).toBe("unknown");
  });
});

describe("formatSenderInline", () => {
  it("renders office name on its own when no doctor", () => {
    expect(
      formatSenderInline({ kind: "match", officeName: "Acme", address: ADDRESS }),
    ).toBe("Acme");
  });

  it("renders doctor · office when both present", () => {
    expect(
      formatSenderInline({
        kind: "match",
        doctorName: "Jane",
        officeName: "Acme",
        address: ADDRESS,
      }),
    ).toBe("Jane · Acme");
  });

  it("renders 'Unknown sender' for unknown", () => {
    expect(formatSenderInline({ kind: "unknown", raw: "x" })).toBe(
      "Unknown sender",
    );
  });
});

describe("senderDisplayLines", () => {
  it("returns 3 lines for a doctor + office match", () => {
    const lines = senderDisplayLines({
      kind: "match",
      doctorName: "Jane Doe, MD",
      officeName: "Acme Clinic",
      address: ADDRESS,
    });
    expect(lines).toEqual([
      "Jane Doe, MD",
      "Acme Clinic",
      "123 Main St, Princeton, NJ 08540",
    ]);
  });

  it("returns 2 lines for office-only match", () => {
    const lines = senderDisplayLines({
      kind: "match",
      officeName: "Acme",
      address: ADDRESS,
    });
    expect(lines).toEqual(["Acme", "123 Main St, Princeton, NJ 08540"]);
  });

  it("returns 'Unknown sender' + raw for unknown", () => {
    const lines = senderDisplayLines({
      kind: "unknown",
      raw: "stranger@nowhere.test",
    });
    expect(lines).toEqual(["Unknown sender", "stranger@nowhere.test"]);
  });
});
