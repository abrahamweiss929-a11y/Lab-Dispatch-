import { describe, it, expect, beforeEach } from "vitest";
import { storageMock, resetStorageMock } from "./storage";
import type { OfficeAddress } from "@/lib/types";

const ADDRESS: OfficeAddress = {
  street: "100 Main St",
  city: "Princeton",
  state: "NJ",
  zip: "08540",
};

describe("storageMock", () => {
  beforeEach(() => {
    resetStorageMock();
  });

  it("creates and lists offices (round-trip)", async () => {
    const created = await storageMock.createOffice({
      name: "Acme Clinic",
      slug: "acme-clinic",
      pickupUrlToken: "tok-acme",
      address: ADDRESS,
    });
    expect(created.id).toBeTruthy();
    const listed = await storageMock.listOffices();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
    expect(listed[0]?.name).toBe("Acme Clinic");
  });

  it("creates and lists drivers (round-trip)", async () => {
    const created = await storageMock.createDriver({
      profileId: "profile-1",
      fullName: "Alice Driver",
      phone: "+15551230001",
      active: true,
    });
    expect(created.profileId).toBe("profile-1");
    expect(created.createdAt).toBeTruthy();
    const listed = await storageMock.listDrivers();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.fullName).toBe("Alice Driver");
  });

  it("creates and lists doctors (round-trip)", async () => {
    const created = await storageMock.createDoctor({
      officeId: "office-1",
      name: "Dr. Smith",
    });
    expect(created.id).toBeTruthy();
    const listed = await storageMock.listDoctors();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it("creates and lists pickup requests (round-trip)", async () => {
    const created = await storageMock.createPickupRequest({
      officeId: "office-1",
      channel: "sms",
      urgency: "routine",
    });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("pending");
    expect(created.createdAt).toBe(created.updatedAt);

    const all = await storageMock.listPickupRequests();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(created.id);
  });

  it("filters pickup requests by status", async () => {
    const pendingOne = await storageMock.createPickupRequest({
      officeId: "office-1",
      channel: "sms",
      urgency: "routine",
    });
    const pendingTwo = await storageMock.createPickupRequest({
      officeId: "office-1",
      channel: "email",
      urgency: "urgent",
    });
    await storageMock.updatePickupRequestStatus(pendingTwo.id, "completed");

    const pending = await storageMock.listPickupRequests({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(pendingOne.id);

    const completed = await storageMock.listPickupRequests({
      status: "completed",
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]?.id).toBe(pendingTwo.id);
  });

  it("updatePickupRequestStatus rejects when id is missing", async () => {
    await expect(
      storageMock.updatePickupRequestStatus("does-not-exist", "completed"),
    ).rejects.toThrow(/not found/);
  });

  it("updatePickupRequestStatus updates updatedAt but preserves createdAt", async () => {
    const created = await storageMock.createPickupRequest({
      officeId: "office-1",
      channel: "sms",
      urgency: "routine",
    });
    // Ensure clock advances so updatedAt differs.
    await new Promise((r) => setTimeout(r, 5));
    const updated = await storageMock.updatePickupRequestStatus(
      created.id,
      "completed",
    );
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(updated.status).toBe("completed");
  });
});
