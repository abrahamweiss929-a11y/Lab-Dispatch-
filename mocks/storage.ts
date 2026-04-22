import { makeRandomId } from "@/lib/ids";
import type {
  ListPickupRequestsFilter,
  NewDoctor,
  NewDriver,
  NewOffice,
  NewPickupRequest,
  StorageService,
} from "@/interfaces/storage";
import type {
  Doctor,
  Driver,
  Office,
  PickupRequest,
  PickupStatus,
} from "@/lib/types";

interface StorageMockState {
  offices: Map<string, Office>;
  drivers: Map<string, Driver>;
  doctors: Map<string, Doctor>;
  pickupRequests: Map<string, PickupRequest>;
}

const state: StorageMockState = {
  offices: new Map(),
  drivers: new Map(),
  doctors: new Map(),
  pickupRequests: new Map(),
};

function nowIso(): string {
  return new Date().toISOString();
}

export const storageMock: StorageService = {
  async listOffices(): Promise<Office[]> {
    return Array.from(state.offices.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  },

  async listDrivers(): Promise<Driver[]> {
    return Array.from(state.drivers.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  },

  async listDoctors(): Promise<Doctor[]> {
    return Array.from(state.doctors.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  },

  async listPickupRequests(
    filter?: ListPickupRequestsFilter,
  ): Promise<PickupRequest[]> {
    const all = Array.from(state.pickupRequests.values());
    const filtered = filter?.status
      ? all.filter((p) => p.status === filter.status)
      : all;
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createOffice(input: NewOffice): Promise<Office> {
    const id = makeRandomId();
    const office: Office = { id, ...input };
    state.offices.set(id, office);
    return office;
  },

  async createDriver(input: NewDriver): Promise<Driver> {
    const driver: Driver = {
      ...input,
      createdAt: nowIso(),
    };
    state.drivers.set(driver.profileId, driver);
    return driver;
  },

  async createDoctor(input: NewDoctor): Promise<Doctor> {
    const id = makeRandomId();
    const doctor: Doctor = { id, ...input };
    state.doctors.set(id, doctor);
    return doctor;
  },

  async createPickupRequest(input: NewPickupRequest): Promise<PickupRequest> {
    const { status: statusInput, ...rest } = input;
    const id = makeRandomId();
    const now = nowIso();
    const record: PickupRequest = {
      id,
      ...rest,
      status: statusInput ?? "pending",
      createdAt: now,
      updatedAt: now,
    };
    state.pickupRequests.set(id, record);
    return record;
  },

  async updatePickupRequestStatus(
    id: string,
    status: PickupStatus,
  ): Promise<PickupRequest> {
    const existing = state.pickupRequests.get(id);
    if (!existing) {
      throw new Error(`pickup request ${id} not found`);
    }
    const updated: PickupRequest = {
      ...existing,
      status,
      updatedAt: nowIso(),
    };
    state.pickupRequests.set(id, updated);
    return updated;
  },
};

export function resetStorageMock(): void {
  state.offices.clear();
  state.drivers.clear();
  state.doctors.clear();
  state.pickupRequests.clear();
}
