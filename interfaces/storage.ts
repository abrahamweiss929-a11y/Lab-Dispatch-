import { NotConfiguredError } from "@/lib/errors";
import type {
  Doctor,
  Driver,
  Office,
  PickupRequest,
  PickupStatus,
} from "@/lib/types";

export interface ListPickupRequestsFilter {
  status?: PickupStatus;
}

export type NewOffice = Omit<Office, "id">;
// NewDriver intentionally drops `profileId` (mock generates one; real adapter
// will generate one via `supabase.auth.admin.createUser`) and carries an
// `email` field that the mock stashes in a side map and the real adapter
// will wire to Supabase Auth. See BLOCKERS.md [supabase].
export type NewDriver = Omit<Driver, "profileId" | "createdAt"> & {
  email: string;
};
export type NewDoctor = Omit<Doctor, "id">;
export type NewPickupRequest = Omit<
  PickupRequest,
  "id" | "status" | "createdAt" | "updatedAt"
> & { status?: PickupStatus };

export interface AdminDashboardCounts {
  drivers: number;
  doctors: number;
  offices: number;
  pendingPickupRequests: number;
}

export interface DriverAccountSummary {
  profileId: string;
  email: string;
}

export interface StorageService {
  listOffices(): Promise<Office[]>;
  listDrivers(): Promise<Driver[]>;
  listDoctors(): Promise<Doctor[]>;
  listPickupRequests(
    filter?: ListPickupRequestsFilter,
  ): Promise<PickupRequest[]>;

  createOffice(input: NewOffice): Promise<Office>;
  createDriver(input: NewDriver): Promise<Driver>;
  createDoctor(input: NewDoctor): Promise<Doctor>;
  createPickupRequest(input: NewPickupRequest): Promise<PickupRequest>;
  updatePickupRequestStatus(
    id: string,
    status: PickupStatus,
  ): Promise<PickupRequest>;

  /** Returns null when the office does not exist. */
  getOffice(id: string): Promise<Office | null>;
  /**
   * Shallow-merges `patch` into the existing office. `address` is treated
   * as a full replacement (not deep-merged) when present. Throws
   * `Error("office <id> not found")` when the id is missing.
   */
  updateOffice(
    id: string,
    patch: Partial<Omit<Office, "id">>,
  ): Promise<Office>;

  /** Returns null when the driver does not exist. */
  getDriver(profileId: string): Promise<Driver | null>;
  /**
   * Shallow-merges `patch` into the existing driver. `profileId` and
   * `createdAt` are never mutated. Throws `Error("driver <id> not found")`
   * when the profileId is missing.
   */
  updateDriver(
    profileId: string,
    patch: Partial<Omit<Driver, "profileId" | "createdAt">>,
  ): Promise<Driver>;
  /**
   * Returns the email for every driver. Mock reads an internal map
   * populated by createDriver; real Supabase implementation will join
   * profiles.email on drivers.profile_id.
   */
  listDriverAccounts(): Promise<DriverAccountSummary[]>;

  /** Returns null when the doctor does not exist. */
  getDoctor(id: string): Promise<Doctor | null>;
  /**
   * Shallow-merges `patch` into the existing doctor. Throws
   * `Error("doctor <id> not found")` when the id is missing.
   */
  updateDoctor(
    id: string,
    patch: Partial<Omit<Doctor, "id">>,
  ): Promise<Doctor>;
  /** Hard deletes. Throws `Error("doctor <id> not found")` when missing. */
  deleteDoctor(id: string): Promise<void>;

  /**
   * Returns totals independent of `active` for drivers and offices, plus
   * the count of pickup requests with `status = "pending"`.
   */
  countAdminDashboard(): Promise<AdminDashboardCounts>;
}

function notConfigured(): never {
  throw new NotConfiguredError({
    service: "storage (Supabase)",
    envVar: "NEXT_PUBLIC_SUPABASE_URL",
  });
}

export function createRealStorageService(): StorageService {
  return {
    async listOffices() {
      notConfigured();
    },
    async listDrivers() {
      notConfigured();
    },
    async listDoctors() {
      notConfigured();
    },
    async listPickupRequests() {
      notConfigured();
    },
    async createOffice() {
      notConfigured();
    },
    async createDriver() {
      notConfigured();
    },
    async createDoctor() {
      notConfigured();
    },
    async createPickupRequest() {
      notConfigured();
    },
    async updatePickupRequestStatus() {
      notConfigured();
    },
    async getOffice() {
      notConfigured();
    },
    async updateOffice() {
      notConfigured();
    },
    async getDriver() {
      notConfigured();
    },
    async updateDriver() {
      notConfigured();
    },
    async listDriverAccounts() {
      notConfigured();
    },
    async getDoctor() {
      notConfigured();
    },
    async updateDoctor() {
      notConfigured();
    },
    async deleteDoctor() {
      notConfigured();
    },
    async countAdminDashboard() {
      notConfigured();
    },
  };
}
