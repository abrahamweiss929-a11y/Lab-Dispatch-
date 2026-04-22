import { describe, it, expect, beforeEach } from "vitest";
import { storageMock, resetStorageMock, getDriverAccount } from "./storage";
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
      active: true,
    });
    expect(created.id).toBeTruthy();
    const listed = await storageMock.listOffices();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
    expect(listed[0]?.name).toBe("Acme Clinic");
    expect(listed[0]?.active).toBe(true);
  });

  it("creates and lists drivers (round-trip)", async () => {
    const created = await storageMock.createDriver({
      email: "alice@test",
      fullName: "Alice Driver",
      phone: "+15551230001",
      active: true,
    });
    expect(typeof created.profileId).toBe("string");
    expect(created.profileId.length).toBeGreaterThan(0);
    expect(created.createdAt).toBeTruthy();
    const listed = await storageMock.listDrivers();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.fullName).toBe("Alice Driver");
  });

  it("createDriver also seeds a mock driver account", async () => {
    const created = await storageMock.createDriver({
      email: "bob@test",
      fullName: "Bob Driver",
      active: true,
    });
    const accounts = await storageMock.listDriverAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toEqual({
      profileId: created.profileId,
      email: "bob@test",
    });
    expect(getDriverAccount(created.profileId)).toEqual({
      email: "bob@test",
      password: "test1234",
    });
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

  it("getDriver / getDoctor / getOffice return null when the id is missing", async () => {
    expect(await storageMock.getDriver("nope")).toBeNull();
    expect(await storageMock.getDoctor("nope")).toBeNull();
    expect(await storageMock.getOffice("nope")).toBeNull();
  });

  it("updateDriver applies a patch, preserves identity fields, and rejects missing ids", async () => {
    const driver = await storageMock.createDriver({
      email: "alice@test",
      fullName: "Alice Driver",
      active: true,
    });
    const createdAt = driver.createdAt;
    const patched = await storageMock.updateDriver(driver.profileId, {
      fullName: "Alice Updated",
      active: false,
    });
    expect(patched.fullName).toBe("Alice Updated");
    expect(patched.active).toBe(false);
    expect(patched.profileId).toBe(driver.profileId);
    expect(patched.createdAt).toBe(createdAt);

    await expect(
      storageMock.updateDriver("missing", { fullName: "x" }),
    ).rejects.toThrow(/not found/);
  });

  it("updateDoctor applies a patch and rejects missing ids", async () => {
    const doctor = await storageMock.createDoctor({
      officeId: "office-1",
      name: "Dr. Smith",
    });
    const patched = await storageMock.updateDoctor(doctor.id, {
      name: "Dr. Jones",
      phone: "+15551112222",
    });
    expect(patched.name).toBe("Dr. Jones");
    expect(patched.phone).toBe("+15551112222");
    expect(patched.officeId).toBe("office-1");

    await expect(
      storageMock.updateDoctor("missing", { name: "x" }),
    ).rejects.toThrow(/not found/);
  });

  it("updateOffice applies a patch and rejects missing ids", async () => {
    const office = await storageMock.createOffice({
      name: "Acme Clinic",
      slug: "acme-clinic",
      pickupUrlToken: "tok-acme",
      address: ADDRESS,
      active: true,
    });
    const patched = await storageMock.updateOffice(office.id, {
      name: "Acme Lab",
      active: false,
    });
    expect(patched.name).toBe("Acme Lab");
    expect(patched.active).toBe(false);
    expect(patched.slug).toBe("acme-clinic");

    await expect(
      storageMock.updateOffice("missing", { name: "x" }),
    ).rejects.toThrow(/not found/);
  });

  it("deleteDoctor removes the row, then getDoctor returns null", async () => {
    const doctor = await storageMock.createDoctor({
      officeId: "office-1",
      name: "Dr. Smith",
    });
    await storageMock.deleteDoctor(doctor.id);
    expect(await storageMock.getDoctor(doctor.id)).toBeNull();
    expect(await storageMock.listDoctors()).toHaveLength(0);
  });

  it("deleteDoctor throws on missing id", async () => {
    await expect(storageMock.deleteDoctor("missing")).rejects.toThrow(
      /not found/,
    );
  });

  it("countAdminDashboard sums correctly across mixed state", async () => {
    await storageMock.createDriver({
      email: "a@test",
      fullName: "A",
      active: true,
    });
    await storageMock.createDriver({
      email: "b@test",
      fullName: "B",
      active: false,
    });

    await storageMock.createDoctor({ officeId: "o1", name: "Dr A" });
    await storageMock.createDoctor({ officeId: "o1", name: "Dr B" });
    await storageMock.createDoctor({ officeId: "o1", name: "Dr C" });

    await storageMock.createOffice({
      name: "Active Office",
      slug: "active-office",
      pickupUrlToken: "tok-1",
      address: ADDRESS,
      active: true,
    });
    await storageMock.createOffice({
      name: "Inactive Office",
      slug: "inactive-office",
      pickupUrlToken: "tok-2",
      address: ADDRESS,
      active: false,
    });

    await storageMock.createPickupRequest({
      officeId: "o1",
      channel: "sms",
      urgency: "routine",
    });
    await storageMock.createPickupRequest({
      officeId: "o1",
      channel: "sms",
      urgency: "routine",
    });
    const third = await storageMock.createPickupRequest({
      officeId: "o1",
      channel: "sms",
      urgency: "routine",
    });
    await storageMock.updatePickupRequestStatus(third.id, "completed");

    expect(await storageMock.countAdminDashboard()).toEqual({
      drivers: 2,
      doctors: 3,
      offices: 2,
      pendingPickupRequests: 2,
    });
  });
});
