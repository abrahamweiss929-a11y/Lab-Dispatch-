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
export type NewDriver = Omit<Driver, "createdAt">;
export type NewDoctor = Omit<Doctor, "id">;
export type NewPickupRequest = Omit<
  PickupRequest,
  "id" | "status" | "createdAt" | "updatedAt"
> & { status?: PickupStatus };

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
  };
}
