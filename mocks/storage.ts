import { makeRandomId } from "@/lib/ids";
import { todayIso } from "@/lib/dates";
import { normalizeUsPhone } from "@/lib/phone";
import type {
  AdminDashboardCounts,
  DispatcherDashboardCounts,
  DriverAccountSummary,
  ListDriverLocationsFilter,
  ListMessagesFilter,
  ListPickupRequestsFilter,
  ListRoutesFilter,
  NewDoctor,
  NewDriver,
  NewDriverLocation,
  NewMessage,
  NewOffice,
  NewPickupRequest,
  NewRoute,
  StorageService,
} from "@/interfaces/storage";
import type {
  Doctor,
  Driver,
  DriverLocation,
  Message,
  Office,
  PickupRequest,
  PickupStatus,
  Route,
  RouteStatus,
  Stop,
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
  routes: Map<string, Route>;
  stops: Map<string, Stop>;
  driverLocations: DriverLocation[];
  messages: Map<string, Message>;
}

const state: StorageMockState = {
  offices: new Map(),
  drivers: new Map(),
  doctors: new Map(),
  pickupRequests: new Map(),
  driverAccounts: new Map(),
  routes: new Map(),
  stops: new Map(),
  driverLocations: [],
  messages: new Map(),
};

function nowIso(): string {
  return new Date().toISOString();
}

function stopsForRoute(routeId: string): Stop[] {
  return Array.from(state.stops.values())
    .filter((s) => s.routeId === routeId)
    .sort((a, b) => a.position - b.position);
}

function passesFlaggedFilter(message: Message): boolean {
  if (message.pickupRequestId === undefined) return true;
  const linked = state.pickupRequests.get(message.pickupRequestId);
  return linked?.status === "flagged";
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
    flaggedReason?: string,
  ): Promise<PickupRequest> {
    const existing = state.pickupRequests.get(id);
    if (!existing) {
      throw new Error(`pickup request ${id} not found`);
    }
    const nextFlaggedReason =
      status === "flagged"
        ? flaggedReason ?? existing.flaggedReason
        : undefined;
    const updated: PickupRequest = {
      ...existing,
      status,
      flaggedReason: nextFlaggedReason,
      updatedAt: nowIso(),
    };
    state.pickupRequests.set(id, updated);
    return updated;
  },

  async getOffice(id: string): Promise<Office | null> {
    return state.offices.get(id) ?? null;
  },

  /**
   * Full-scan lookup by (slug, pickupUrlToken). Matches only `active`
   * offices — inactive rows resolve to null because the public pickup
   * form must treat deactivated links as unknown. Real Supabase adapter
   * will back this with an index on (slug, pickup_url_token).
   */
  async findOfficeBySlugToken(
    slug: string,
    token: string,
  ): Promise<Office | null> {
    for (const office of state.offices.values()) {
      if (
        office.slug === slug &&
        office.pickupUrlToken === token &&
        office.active
      ) {
        return office;
      }
    }
    return null;
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

  async listRoutes(filter?: ListRoutesFilter): Promise<Route[]> {
    let out = Array.from(state.routes.values());
    if (filter?.date !== undefined) {
      out = out.filter((r) => r.routeDate === filter.date);
    }
    if (filter?.driverId !== undefined) {
      out = out.filter((r) => r.driverId === filter.driverId);
    }
    if (filter?.status !== undefined) {
      out = out.filter((r) => r.status === filter.status);
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async getRoute(id: string): Promise<Route | null> {
    return state.routes.get(id) ?? null;
  },

  async createRoute(input: NewRoute): Promise<Route> {
    const id = makeRandomId();
    const route: Route = {
      id,
      driverId: input.driverId,
      routeDate: input.routeDate,
      status: "pending",
      createdAt: nowIso(),
    };
    state.routes.set(id, route);
    return route;
  },

  async updateRouteStatus(id: string, status: RouteStatus): Promise<Route> {
    const existing = state.routes.get(id);
    if (!existing) {
      throw new Error(`route ${id} not found`);
    }
    const now = nowIso();
    const next: Route = { ...existing, status };
    if (status === "active") {
      if (!next.startedAt) next.startedAt = now;
    } else if (status === "completed") {
      if (!next.completedAt) next.completedAt = now;
    } else if (status === "pending") {
      next.startedAt = undefined;
      next.completedAt = undefined;
    }
    state.routes.set(id, next);
    return next;
  },

  async listStops(routeId: string): Promise<Stop[]> {
    return stopsForRoute(routeId);
  },

  async assignRequestToRoute(
    routeId: string,
    pickupRequestId: string,
    position?: number,
  ): Promise<Stop> {
    const route = state.routes.get(routeId);
    if (!route) {
      throw new Error(`route ${routeId} not found`);
    }
    const request = state.pickupRequests.get(pickupRequestId);
    if (!request) {
      throw new Error(`pickup request ${pickupRequestId} not found`);
    }
    const existingStopForRequest = Array.from(state.stops.values()).find(
      (s) => s.pickupRequestId === pickupRequestId,
    );
    if (existingStopForRequest) {
      throw new Error("pickup request already assigned");
    }
    const currentStops = stopsForRoute(routeId);
    let nextPosition: number;
    if (position === undefined) {
      nextPosition =
        currentStops.length === 0
          ? 1
          : Math.max(...currentStops.map((s) => s.position)) + 1;
    } else {
      if (currentStops.some((s) => s.position === position)) {
        throw new Error(`stop at position ${position} already exists`);
      }
      nextPosition = position;
    }
    const id = makeRandomId();
    const stop: Stop = {
      id,
      routeId,
      pickupRequestId,
      position: nextPosition,
      notified10min: false,
      createdAt: nowIso(),
    };
    state.stops.set(id, stop);
    // Flip the pickup request to "assigned" inline (bypasses
    // updatePickupRequestStatus to keep this call self-contained).
    state.pickupRequests.set(pickupRequestId, {
      ...request,
      status: "assigned",
      updatedAt: nowIso(),
    });
    return stop;
  },

  async removeStopFromRoute(stopId: string): Promise<void> {
    const stop = state.stops.get(stopId);
    if (!stop) {
      throw new Error(`stop ${stopId} not found`);
    }
    const { routeId, pickupRequestId } = stop;
    state.stops.delete(stopId);
    // Re-number survivors contiguously.
    const survivors = stopsForRoute(routeId);
    survivors.forEach((s, idx) => {
      state.stops.set(s.id, { ...s, position: idx + 1 });
    });
    // Flip the pickup request back to "pending", clear any flaggedReason.
    const request = state.pickupRequests.get(pickupRequestId);
    if (request) {
      state.pickupRequests.set(pickupRequestId, {
        ...request,
        status: "pending",
        flaggedReason: undefined,
        updatedAt: nowIso(),
      });
    }
  },

  async reorderStops(
    routeId: string,
    orderedStopIds: string[],
  ): Promise<void> {
    if (!state.routes.has(routeId)) {
      throw new Error(`route ${routeId} not found`);
    }
    const currentStops = stopsForRoute(routeId);
    if (orderedStopIds.length !== currentStops.length) {
      throw new Error("orderedStopIds length does not match route stop count");
    }
    const currentIds = new Set(currentStops.map((s) => s.id));
    for (const id of orderedStopIds) {
      const stop = state.stops.get(id);
      if (!stop) {
        throw new Error(`stop ${id} not found`);
      }
      if (stop.routeId !== routeId) {
        throw new Error(`stop ${id} does not belong to route ${routeId}`);
      }
      if (!currentIds.has(id)) {
        throw new Error(`stop ${id} is not on route ${routeId}`);
      }
    }
    orderedStopIds.forEach((id, idx) => {
      const stop = state.stops.get(id);
      if (stop) {
        state.stops.set(id, { ...stop, position: idx + 1 });
      }
    });
  },

  async getStop(id: string): Promise<Stop | null> {
    return state.stops.get(id) ?? null;
  },

  async markStopArrived(stopId: string): Promise<Stop> {
    const stop = state.stops.get(stopId);
    if (!stop) {
      throw new Error(`stop ${stopId} not found`);
    }
    if (stop.arrivedAt) {
      throw new Error(`stop ${stopId} already arrived`);
    }
    const updated: Stop = { ...stop, arrivedAt: nowIso() };
    state.stops.set(stopId, updated);
    return updated;
  },

  async markStopPickedUp(stopId: string): Promise<Stop> {
    const stop = state.stops.get(stopId);
    if (!stop) {
      throw new Error(`stop ${stopId} not found`);
    }
    if (!stop.arrivedAt) {
      throw new Error(`stop ${stopId} not yet arrived`);
    }
    if (stop.pickedUpAt) {
      throw new Error(`stop ${stopId} already picked up`);
    }
    const updated: Stop = { ...stop, pickedUpAt: nowIso() };
    state.stops.set(stopId, updated);
    return updated;
  },

  async markStopNotified10min(stopId: string): Promise<Stop> {
    const stop = state.stops.get(stopId);
    if (!stop) {
      throw new Error(`stop ${stopId} not found`);
    }
    if (stop.notified10min) {
      return stop;
    }
    const updated: Stop = { ...stop, notified10min: true };
    state.stops.set(stopId, updated);
    return updated;
  },

  async updateStopEta(stopId: string, etaAtIso: string): Promise<Stop> {
    const stop = state.stops.get(stopId);
    if (!stop) {
      throw new Error(`stop ${stopId} not found`);
    }
    const updated: Stop = { ...stop, etaAt: etaAtIso };
    state.stops.set(stopId, updated);
    return updated;
  },

  async getPickupRequest(id: string): Promise<PickupRequest | null> {
    return state.pickupRequests.get(id) ?? null;
  },

  async recordDriverLocation(
    input: NewDriverLocation,
  ): Promise<DriverLocation> {
    const id = String(state.driverLocations.length + 1);
    const loc: DriverLocation = {
      id,
      driverId: input.driverId,
      routeId: input.routeId,
      lat: input.lat,
      lng: input.lng,
      recordedAt: input.recordedAt ?? nowIso(),
    };
    state.driverLocations.push(loc);
    return loc;
  },

  async listDriverLocations(
    filter?: ListDriverLocationsFilter,
  ): Promise<DriverLocation[]> {
    const sinceMinutes = filter?.sinceMinutes ?? 15;
    const cutoff = Date.now() - sinceMinutes * 60_000;
    const fresh = state.driverLocations.filter((loc) => {
      const ts = Date.parse(loc.recordedAt);
      return Number.isFinite(ts) && ts >= cutoff;
    });
    const latestPerDriver = new Map<string, DriverLocation>();
    for (const loc of fresh) {
      const existing = latestPerDriver.get(loc.driverId);
      if (
        !existing ||
        Date.parse(loc.recordedAt) > Date.parse(existing.recordedAt)
      ) {
        latestPerDriver.set(loc.driverId, loc);
      }
    }
    return Array.from(latestPerDriver.values()).sort((a, b) =>
      b.recordedAt.localeCompare(a.recordedAt),
    );
  },

  async listMessages(filter?: ListMessagesFilter): Promise<Message[]> {
    let out = Array.from(state.messages.values());
    if (filter?.flagged === true) {
      out = out.filter(passesFlaggedFilter);
    }
    return out.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  },

  async createRequestFromMessage(messageId: string): Promise<PickupRequest> {
    const message = state.messages.get(messageId);
    if (!message) {
      throw new Error(`message ${messageId} not found`);
    }
    if (message.pickupRequestId !== undefined) {
      throw new Error("message already linked");
    }
    const id = makeRandomId();
    const now = nowIso();
    const newRequest: PickupRequest = {
      id,
      channel: message.channel,
      urgency: "routine",
      sourceIdentifier: message.fromIdentifier,
      rawMessage: message.body,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    state.pickupRequests.set(id, newRequest);
    state.messages.set(messageId, { ...message, pickupRequestId: id });
    return newRequest;
  },

  async createMessage(input: NewMessage): Promise<Message> {
    const id = makeRandomId();
    const record: Message = {
      id,
      channel: input.channel,
      fromIdentifier: input.fromIdentifier,
      subject: input.subject,
      body: input.body,
      receivedAt: input.receivedAt ?? nowIso(),
      pickupRequestId: input.pickupRequestId,
    };
    state.messages.set(id, record);
    return record;
  },

  async findOfficeByPhone(phone: string): Promise<Office | null> {
    const normalizedInput = normalizeUsPhone(phone);
    if (normalizedInput === null) return null;
    for (const office of state.offices.values()) {
      if (office.phone === undefined) continue;
      const normalizedOffice = normalizeUsPhone(office.phone);
      if (normalizedOffice === null) continue;
      if (normalizedOffice === normalizedInput && office.active) {
        return office;
      }
    }
    return null;
  },

  async findOfficeByEmail(email: string): Promise<Office | null> {
    const needle = email.trim().toLowerCase();
    if (needle.length === 0) return null;
    for (const office of state.offices.values()) {
      if (office.email === undefined) continue;
      if (office.email.trim().toLowerCase() === needle && office.active) {
        return office;
      }
    }
    return null;
  },

  async linkMessageToRequest(
    messageId: string,
    pickupRequestId: string,
  ): Promise<Message> {
    const message = state.messages.get(messageId);
    if (!message) {
      throw new Error(`message ${messageId} not found`);
    }
    if (
      message.pickupRequestId !== undefined &&
      message.pickupRequestId !== pickupRequestId
    ) {
      throw new Error("message already linked");
    }
    const updated: Message = { ...message, pickupRequestId };
    state.messages.set(messageId, updated);
    return updated;
  },

  async countDispatcherDashboard(
    dateIso?: string,
  ): Promise<DispatcherDashboardCounts> {
    const date = dateIso ?? todayIso();
    const pendingRequests = Array.from(state.pickupRequests.values()).filter(
      (r) => r.status === "pending",
    ).length;
    const routesOnDate = new Set(
      Array.from(state.routes.values())
        .filter((r) => r.routeDate === date)
        .map((r) => r.id),
    );
    const todayStops = Array.from(state.stops.values()).filter((s) =>
      routesOnDate.has(s.routeId),
    ).length;
    const activeRoutes = Array.from(state.routes.values()).filter(
      (r) => r.status === "active",
    ).length;
    const flaggedMessages = Array.from(state.messages.values()).filter(
      passesFlaggedFilter,
    ).length;
    return { pendingRequests, todayStops, activeRoutes, flaggedMessages };
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

/** Test-only helper. */
export function seedRoute(route: Route): void {
  state.routes.set(route.id, route);
}

/** Test-only helper. */
export function seedStop(stop: Stop): void {
  state.stops.set(stop.id, stop);
}

/** Test-only helper. */
export function seedDriverLocation(loc: DriverLocation): void {
  state.driverLocations.push(loc);
}

/** Test-only helper. */
export function seedMessage(message: Message): void {
  state.messages.set(message.id, message);
}

export function resetStorageMock(): void {
  state.offices.clear();
  state.drivers.clear();
  state.doctors.clear();
  state.pickupRequests.clear();
  state.driverAccounts.clear();
  state.routes.clear();
  state.stops.clear();
  state.driverLocations.length = 0;
  state.messages.clear();
}
