import { makeRandomId } from "@/lib/ids";
import type {
  AdminDashboardCounts,
  DriverAccountSummary,
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

// The `driverAccounts` side map and the hard-coded `MOCK_PASSWORD` are
// mock-only artifacts that simulate what `supabase.auth.admin.createUser`
// will do in production. See BLOCKERS.md [supabase] for the migration
// note that removes this side map in favor of joining `profiles.email`
// on `drivers.profile_id`.
const MOCK_PASSWORD = "test1234";

interface DriverAccount {
  email: string;
  password: string;
}

interface StorageMockState {
  offices: Map<string, Office>;
  drivers: Map<string, Driver>;
  doctors: Map<string, Doctor>;
  pickupRequests: Map<string, PickupRequest>;
  driverAccounts: Map<string, DriverAccount>;
}

const state: StorageMockState = {
  offices: new Map(),
  drivers: new Map(),
  doctors: new Map(),
  pickupRequests: new Map(),
  driverAccounts: new Map(),
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
    const profileId = globalThis.crypto.randomUUID();
    const { email, ...rest } = input;
    const driver: Driver = {
      ...rest,
      profileId,
      createdAt: nowIso(),
    };
    state.drivers.set(profileId, driver);
    state.driverAccounts.set(profileId, { email, password: MOCK_PASSWORD });
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

  async getOffice(id: string): Promise<Office | null> {
    return state.offices.get(id) ?? null;
  },

  async updateOffice(
    id: string,
    patch: Partial<Omit<Office, "id">>,
  ): Promise<Office> {
    const existing = state.offices.get(id);
    if (!existing) {
      throw new Error(`office ${id} not found`);
    }
    const updated: Office = { ...existing, ...patch };
    state.offices.set(id, updated);
    return updated;
  },

  async getDriver(profileId: string): Promise<Driver | null> {
    return state.drivers.get(profileId) ?? null;
  },

  async updateDriver(
    profileId: string,
    patch: Partial<Omit<Driver, "profileId" | "createdAt">>,
  ): Promise<Driver> {
    const existing = state.drivers.get(profileId);
    if (!existing) {
      throw new Error(`driver ${profileId} not found`);
    }
    const updated: Driver = {
      ...existing,
      ...patch,
      profileId: existing.profileId,
      createdAt: existing.createdAt,
    };
    state.drivers.set(profileId, updated);
    return updated;
  },

  async listDriverAccounts(): Promise<DriverAccountSummary[]> {
    return Array.from(state.driverAccounts.entries())
      .map(([profileId, { email }]) => ({ profileId, email }))
      .sort((a, b) => a.profileId.localeCompare(b.profileId));
  },

  async getDoctor(id: string): Promise<Doctor | null> {
    return state.doctors.get(id) ?? null;
  },

  async updateDoctor(
    id: string,
    patch: Partial<Omit<Doctor, "id">>,
  ): Promise<Doctor> {
    const existing = state.doctors.get(id);
    if (!existing) {
      throw new Error(`doctor ${id} not found`);
    }
    const updated: Doctor = { ...existing, ...patch, id: existing.id };
    state.doctors.set(id, updated);
    return updated;
  },

  async deleteDoctor(id: string): Promise<void> {
    if (!state.doctors.has(id)) {
      throw new Error(`doctor ${id} not found`);
    }
    state.doctors.delete(id);
  },

  async countAdminDashboard(): Promise<AdminDashboardCounts> {
    const pendingPickupRequests = Array.from(
      state.pickupRequests.values(),
    ).filter((r) => r.status === "pending").length;
    return {
      drivers: state.drivers.size,
      doctors: state.doctors.size,
      offices: state.offices.size,
      pendingPickupRequests,
    };
  },
};

/**
 * Test-only helper: reveals the mock auth account created when a driver
 * was inserted via `createDriver`. NOT part of the StorageService
 * interface — the real Supabase adapter will not need or expose it.
 */
export function getDriverAccount(
  profileId: string,
): { email: string; password: string } | undefined {
  return state.driverAccounts.get(profileId);
}

export function resetStorageMock(): void {
  state.offices.clear();
  state.drivers.clear();
  state.doctors.clear();
  state.pickupRequests.clear();
  state.driverAccounts.clear();
}
