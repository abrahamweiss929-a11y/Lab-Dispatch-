import { describe, it, expect, beforeEach } from "vitest";

import {
  INITIAL_PICKUP_FORM_STATE,
  submitPickupRequestAction,
} from "./actions";
import { resetAllMocks } from "@/interfaces";
import { storageMock } from "@/mocks/storage";
import { getSentEmails } from "@/mocks/email";
import { pickupFormBucket } from "@/lib/rate-limit";

const ADDRESS = {
  street: "100 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    form.set(key, value);
  }
  return form;
}

async function seedOffice(
  overrides: Partial<{
    slug: string;
    pickupUrlToken: string;
    email?: string;
    phone?: string;
    active: boolean;
    name: string;
  }> = {},
) {
  return storageMock.createOffice({
    name: overrides.name ?? "Acme Clinic",
    slug: overrides.slug ?? "acme-clinic",
    pickupUrlToken: overrides.pickupUrlToken ?? "a1b2c3d4e5f6",
    address: ADDRESS,
    active: overrides.active ?? true,
    email: overrides.email,
    phone: overrides.phone,
  });
}

describe("submitPickupRequestAction", () => {
  beforeEach(() => {
    resetAllMocks();
    pickupFormBucket.reset();
  });

  it("happy path: persists a web pickup request and sends a confirmation email", async () => {
    const office = await seedOffice({ email: "front-desk@acme.test" });
    const notes = "Two samples for routine pickup, back door.";
    const state = await submitPickupRequestAction(
      INITIAL_PICKUP_FORM_STATE,
      fd({
        slugToken: "acme-clinic-a1b2c3d4e5f6",
        notes,
        urgency: "routine",
        sampleCount: "2",
      }),
    );

    expect(state.status).toBe("ok");
    if (state.status !== "ok") return;
    expect(state.requestId).toBeTruthy();
    expect(state.etaText).toBe("within about 2 hours");

    const rows = await storageMock.listPickupRequests();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.channel).toBe("web");
    expect(rows[0]?.officeId).toBe(office.id);
    expect(rows[0]?.specialInstructions).toBe(notes);
    expect(rows[0]?.rawMessage).toBe(notes);
    expect(rows[0]?.sampleCount).toBe(2);
    expect(rows[0]?.sourceIdentifier).toBe("acme-clinic-a1b2c3d4e5f6");
    expect(rows[0]?.urgency).toBe("routine");

    const emails = getSentEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toBe("front-desk@acme.test");
    expect(emails[0]?.subject).toContain("Acme Clinic");
    expect(emails[0]?.body).toContain("within about 2 hours");
  });

  it("defaults urgency to routine when the field is blank", async () => {
    await seedOffice({ email: "x@acme.test" });
    const state = await submitPickupRequestAction(
      INITIAL_PICKUP_FORM_STATE,
      fd({
        slugToken: "acme-clinic-a1b2c3d4e5f6",
        notes: "Please come by this afternoon for two samples.",
        urgency: "",
        sampleCount: "",
      }),
    );
    expect(state.status).toBe("ok");
    const rows = await storageMock.listPickupRequests();
    expect(rows[0]?.urgency).toBe("routine");
    expect(rows[0]?.sampleCount).toBeUndefined();
  });

  it("returns field error when notes are missing", async () => {
    await seedOffice();
    const state = await submitPickupRequestAction(
      INITIAL_PICKUP_FORM_STATE,
      fd({
        slugToken: "acme-clinic-a1b2c3d4e5f6",
        notes: "",
        urgency: "routine",
        sampleCount: "",
      }),
    );
    expect(state.status).toBe("error");
    if (state.status !== "error") return;
    expect(state.fieldErrors.notes).toBeTruthy();
    expect(await storageMock.listPickupRequests()).toHaveLength(0);
    expect(getSentEmails()).toHaveLength(0);
  });

  it("returns field error when notes are too short (5 chars)", async () => {
    await seedOffice();
    const state = await submitPickupRequestAction(
      INITIAL_PICKUP_FORM_STATE,
      fd({
        slugToken: "acme-clinic-a1b2c3d4e5f6",
        notes: "short",
        urgency: "routine",
        sampleCount: "",
      }),
    );
    expect(state.status).toBe("error");
    if (state.status !== "error") return;
    expect(state.fieldErrors.notes).toBeTruthy();
    expect(await storageMock.listPickupRequests()).toHaveLength(0);
  });

  it("returns a generic error when the slugToken has no matching office", async () => {
    // Seed an unrelated office so storage isn't empty.
    await seedOffice({ slug: "other-clinic", pickupUrlToken: "aaaaaaaaaaaa" });
    const state = await submitPickupRequestAction(
      INITIAL_PICKUP_FORM_STATE,
      fd({
        slugToken: "ghost-clinic-a1b2c3d4e5f6",
        notes: "Two samples for routine pickup, back door.",
        urgency: "routine",
        sampleCount: "",
      }),
    );
    expect(state.status).toBe("error");
    if (state.status !== "error") return;
    expect(state.error).toBeTruthy();
    expect(state.fieldErrors).toEqual({});
    expect(await storageMock.listPickupRequests()).toHaveLength(0);
    expect(getSentEmails()).toHaveLength(0);
  });

  it("succeeds without sending email when office.email is absent", async () => {
    await seedOffice({ email: undefined });
    const state = await submitPickupRequestAction(
      INITIAL_PICKUP_FORM_STATE,
      fd({
        slugToken: "acme-clinic-a1b2c3d4e5f6",
        notes: "Two samples for routine pickup, back door.",
        urgency: "routine",
        sampleCount: "",
      }),
    );
    expect(state.status).toBe("ok");
    expect(getSentEmails()).toHaveLength(0);
    expect(await storageMock.listPickupRequests()).toHaveLength(1);
  });

  it("enforces the 10-per-5-minutes rate limit and persists only 10 requests", async () => {
    await seedOffice({ email: "x@acme.test" });
    const body = {
      slugToken: "acme-clinic-a1b2c3d4e5f6",
      notes: "Two samples for routine pickup, back door.",
      urgency: "routine",
      sampleCount: "",
    };

    for (let i = 0; i < 10; i += 1) {
      const s = await submitPickupRequestAction(
        INITIAL_PICKUP_FORM_STATE,
        fd(body),
      );
      expect(s.status).toBe("ok");
    }
    const eleventh = await submitPickupRequestAction(
      INITIAL_PICKUP_FORM_STATE,
      fd(body),
    );
    expect(eleventh.status).toBe("error");
    if (eleventh.status !== "error") return;
    expect(eleventh.error).toMatch(/too many/i);
    expect(await storageMock.listPickupRequests()).toHaveLength(10);
  });

  it("returns field error for an invalid urgency value", async () => {
    await seedOffice();
    const state = await submitPickupRequestAction(
      INITIAL_PICKUP_FORM_STATE,
      fd({
        slugToken: "acme-clinic-a1b2c3d4e5f6",
        notes: "Two samples for routine pickup, back door.",
        urgency: "whenever",
        sampleCount: "",
      }),
    );
    expect(state.status).toBe("error");
    if (state.status !== "error") return;
    expect(state.fieldErrors.urgency).toBeTruthy();
    expect(await storageMock.listPickupRequests()).toHaveLength(0);
  });

  it.each(["0", "100", "abc"]) (
    "returns field error for invalid sampleCount %s",
    async (bad) => {
      await seedOffice();
      const state = await submitPickupRequestAction(
        INITIAL_PICKUP_FORM_STATE,
        fd({
          slugToken: "acme-clinic-a1b2c3d4e5f6",
          notes: "Two samples for routine pickup, back door.",
          urgency: "routine",
          sampleCount: bad,
        }),
      );
      expect(state.status).toBe("error");
      if (state.status !== "error") return;
      expect(state.fieldErrors.sampleCount).toBeTruthy();
      expect(await storageMock.listPickupRequests()).toHaveLength(0);
    },
  );
});
