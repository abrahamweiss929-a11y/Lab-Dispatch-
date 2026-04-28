import type {
  Doctor,
  Driver,
  DriverLocation,
  Message,
  Office,
  PickupChannel,
  PickupRequest,
  PickupStatus,
  Route,
  RouteStatus,
  Stop,
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

export interface ListRoutesFilter {
  /** "YYYY-MM-DD" — matches `routes.route_date`. */
  date?: string;
  driverId?: string;
  status?: RouteStatus;
}

export interface ListDriverLocationsFilter {
  /** Default: 15. */
  sinceMinutes?: number;
}

export interface NewDriverLocation {
  driverId: string;
  routeId?: string;
  /** -90..90 */
  lat: number;
  /** -180..180 */
  lng: number;
  /** ISO8601; defaults to now. */
  recordedAt?: string;
}

export interface ListMessagesFilter {
  /**
   * When true, returns messages whose `pickupRequestId` is unset (orphans
   * / unknown senders) OR whose linked pickup request has `status =
   * 'flagged'`. When undefined/false, returns all messages.
   */
  flagged?: boolean;
}

export interface NewMessage {
  /** "sms" | "email" — pipeline never calls with "web" | "manual". */
  channel: PickupChannel;
  fromIdentifier: string;
  subject?: string;
  body: string;
  /** Defaults to now when omitted. */
  receivedAt?: string;
  /** Almost always unset at create-time. */
  pickupRequestId?: string;
}

export interface NewRoute {
  driverId: string;
  /** "YYYY-MM-DD". */
  routeDate: string;
}

export interface DispatcherDashboardCounts {
  /** `pickup_requests.status = 'pending'` (any date). */
  pendingRequests: number;
  /** Stops on routes whose `route_date` equals the target date. */
  todayStops: number;
  /** `routes.status = 'active'` (any date). */
  activeRoutes: number;
  /** Messages that would pass the `flagged: true` filter. */
  flaggedMessages: number;
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
  /**
   * Extends the base status transition with an optional `flaggedReason`
   * that is written when present. When `status !== "flagged"`, any
   * previously-stored `flaggedReason` is cleared.
   */
  updatePickupRequestStatus(
    id: string,
    status: PickupStatus,
    flaggedReason?: string,
  ): Promise<PickupRequest>;

  /** Returns null when the office does not exist. */
  getOffice(id: string): Promise<Office | null>;
  /**
   * Returns the office whose (slug, pickupUrlToken) pair matches, and
   * only when `active === true`. Inactive matches resolve to null — the
   * public pickup form treats them as unknown. Real Supabase adapter
   * will back this with an index on (slug, pickup_url_token) for O(1)
   * lookup; the mock full-scans.
   */
  findOfficeBySlugToken(slug: string, token: string): Promise<Office | null>;
  /**
   * Returns the active office whose `slug + '-' + pickupUrlToken`
   * composite equals the given URL segment. Use this instead of
   * `findOfficeBySlugToken` for `/pickup/{segment}` lookups — the
   * composite match is the only way to handle slugs and tokens that
   * both contain hyphens. Inactive offices resolve to null.
   */
  findOfficeByPickupUrlSegment(segment: string): Promise<Office | null>;
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

  // Routes ------------------------------------------------------------------

  listRoutes(filter?: ListRoutesFilter): Promise<Route[]>;
  getRoute(id: string): Promise<Route | null>;
  /** Status defaults to `"pending"`. */
  createRoute(input: NewRoute): Promise<Route>;
  /**
   * Transitions:
   *   - pending → active: sets `startedAt = now` if unset.
   *   - active → completed: sets `completedAt = now` if unset.
   *   - anything → pending: clears `startedAt` AND `completedAt`.
   * Throws `Error("route <id> not found")` on bad id.
   */
  updateRouteStatus(id: string, status: RouteStatus): Promise<Route>;

  // Stops -------------------------------------------------------------------

  /** Ordered by `position` ascending. */
  listStops(routeId: string): Promise<Stop[]>;
  /**
   * Side effects:
   *   1. Inserts a stop row.
   *   2. Patches the pickup request's status to `"assigned"`.
   * Position defaults to `max(existing positions on route) + 1` (starting
   * at 1 for an empty route). With an explicit `position` that collides
   * with an existing stop, throws `"stop at position N already exists"`
   * (matches the SQL `unique (route_id, position)` invariant).
   * Throws `"route <id> not found"` / `"pickup request <id> not found"`
   * on bad ids, or `"pickup request already assigned"` when a stop
   * already exists for this request anywhere.
   */
  assignRequestToRoute(
    routeId: string,
    pickupRequestId: string,
    position?: number,
  ): Promise<Stop>;
  /**
   * Side effects:
   *   1. Deletes the stop row.
   *   2. Re-numbers remaining stops on that route to be 1..N contiguous.
   *   3. Flips the underlying pickup request back to `"pending"` and
   *      clears any `flaggedReason`.
   * Throws `"stop <id> not found"` on bad id.
   */
  removeStopFromRoute(stopId: string): Promise<void>;
  /**
   * Rewrites `position` = 1..N in the given order. Throws if:
   *   - routeId is unknown.
   *   - `orderedStopIds.length !== current stops count`.
   *   - any id in `orderedStopIds` is missing from the route.
   *   - any stop id belongs to a different route.
   */
  reorderStops(routeId: string, orderedStopIds: string[]): Promise<void>;

  // Stop check-ins ---------------------------------------------------------

  /** Returns null when the stop does not exist. */
  getStop(id: string): Promise<Stop | null>;

  /**
   * Sets `arrivedAt = now` if unset and returns the updated Stop.
   * Throws `"stop <id> not found"` on bad id.
   * Throws `"stop <id> already arrived"` when arrivedAt is already set.
   */
  markStopArrived(stopId: string): Promise<Stop>;

  /**
   * Sets `pickedUpAt = now` if unset and returns the updated Stop.
   * Throws `"stop <id> not found"` on bad id.
   * Throws `"stop <id> not yet arrived"` when arrivedAt is unset
   *   (we enforce the arrived → picked-up ordering).
   * Throws `"stop <id> already picked up"` when pickedUpAt is already set.
   */
  markStopPickedUp(stopId: string): Promise<Stop>;

  /**
   * Sets `notified10min = true` when currently false and returns the
   * updated Stop. Idempotent — calling this when the flag is already true
   * returns the existing Stop without modification (does NOT throw). The
   * heads-up module also checks the flag before calling so idempotency is
   * belt-and-suspenders; retry-safe for future real-adapter callers.
   * Throws `"stop <id> not found"` on bad id.
   */
  markStopNotified10min(stopId: string): Promise<Stop>;

  /**
   * Overwrites `etaAt` with the given ISO8601 string. No validation of the
   * timestamp format (caller's job). Throws `"stop <id> not found"` on
   * bad id.
   */
  updateStopEta(stopId: string, etaAtIso: string): Promise<Stop>;

  // Pickup request lookups -------------------------------------------------

  /**
   * Returns a single pickup request by id, or null when the id is not
   * known. Cheaper than `listPickupRequests().find(...)` for callers (like
   * the heads-up module) that only need a single row.
   */
  getPickupRequest(id: string): Promise<PickupRequest | null>;

  // Driver locations --------------------------------------------------------

  /**
   * Returns AT MOST one row per driver — the most recent location per
   * driver whose `recordedAt` is within `sinceMinutes` of now (default
   * 15). Sorted by `recordedAt` descending.
   */
  listDriverLocations(
    filter?: ListDriverLocationsFilter,
  ): Promise<DriverLocation[]>;

  /**
   * Appends a row to driver_locations. `recordedAt` defaults to now when
   * omitted. Returns the inserted row. No throws on happy path; numeric
   * range validation is the caller's responsibility (the server action
   * does it).
   */
  recordDriverLocation(input: NewDriverLocation): Promise<DriverLocation>;

  // Messages ----------------------------------------------------------------

  /**
   * When `filter.flagged === true`, returns messages whose
   * `pickupRequestId` is unset OR points at a pickup request with
   * `status = "flagged"`. When undefined/false, returns all messages.
   * Sorted by `receivedAt` descending.
   */
  listMessages(filter?: ListMessagesFilter): Promise<Message[]>;
  /**
   * Creates a new pickup request seeded from the message:
   *   - channel = message.channel
   *   - officeId = undefined (dispatcher fills in later)
   *   - sourceIdentifier = message.fromIdentifier
   *   - rawMessage = message.body
   *   - urgency = "routine" (default)
   *   - status = "pending"
   * Then sets `message.pickupRequestId = new request's id`. Returns the
   * new request.
   * Throws `"message <id> not found"` on bad id, or `"message already
   * linked"` when `message.pickupRequestId` is already set.
   */
  createRequestFromMessage(messageId: string): Promise<PickupRequest>;

  /** Inserts a `messages` row. Returns the stored Message. */
  createMessage(input: NewMessage): Promise<Message>;

  /**
   * Matches an office by `phone`. Caller is responsible for normalization;
   * the mock re-normalizes both sides via `normalizeUsPhone` so that
   * offices stored with loose formatting still match. Returns null on no
   * match or when the matching office is inactive.
   */
  findOfficeByPhone(phone: string): Promise<Office | null>;

  /**
   * Matches an office by `email`, case-insensitive. Trims surrounding
   * whitespace on both sides. Returns null on no match or inactive.
   */
  findOfficeByEmail(email: string): Promise<Office | null>;

  /**
   * Updates `messages.pickupRequestId`. Throws `"message <id> not found"`
   * on bad id. Idempotent when the target id already matches; throws
   * `"message already linked"` when the stored id differs.
   */
  linkMessageToRequest(
    messageId: string,
    pickupRequestId: string,
  ): Promise<Message>;

  // Dispatcher dashboard ----------------------------------------------------

  /**
   * `dateIso` ("YYYY-MM-DD") filters `todayStops`. Defaults to UTC today
   * when undefined.
   */
  countDispatcherDashboard(
    dateIso?: string,
  ): Promise<DispatcherDashboardCounts>;
}

// The real adapter lives in a `"server-only"` module so webpack errors
// if anyone accidentally pulls it into a Client Component. Callers
// continue to import the interface + helper types from this file.
export { createRealStorageService } from "./storage.real";
