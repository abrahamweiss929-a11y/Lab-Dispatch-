/**
 * Pure functions that translate between Supabase DB rows (snake_case,
 * nullable) and domain types in `lib/types.ts` (camelCase, optional). One
 * trio per table: `dbXToX`, `xToDbInsert`, `xPatchToDbUpdate`.
 *
 * No supabase-js imports here — these functions are shape-only and must
 * remain trivially unit-testable without any I/O.
 */
import type {
  Doctor,
  Driver,
  DriverLocation,
  Message,
  Office,
  PickupChannel,
  PickupRequest,
  PickupStatus,
  PickupUrgency,
  Route,
  RouteStatus,
  Stop,
} from "@/lib/types";
import type {
  NewDoctor,
  NewDriverLocation,
  NewMessage,
  NewOffice,
  NewPickupRequest,
  NewRoute,
} from "@/interfaces/storage";

// ---------- Offices -----------------------------------------------------

export interface DbOfficeRow {
  id: string;
  name: string;
  slug: string;
  pickup_url_token: string;
  phone: string | null;
  email: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  lat: number | null;
  lng: number | null;
  active: boolean;
  created_at: string;
}

export type DbOfficeInsert = Omit<DbOfficeRow, "id" | "created_at">;
export type DbOfficeUpdate = Partial<Omit<DbOfficeRow, "id" | "created_at">>;

export function dbOfficeToOffice(row: DbOfficeRow): Office {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    pickupUrlToken: row.pickup_url_token,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    address: {
      street: row.address_street ?? "",
      city: row.address_city ?? "",
      state: row.address_state ?? "",
      zip: row.address_zip ?? "",
    },
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    active: row.active,
  };
}

export function officeToDbInsert(input: NewOffice): DbOfficeInsert {
  return {
    name: input.name,
    slug: input.slug,
    pickup_url_token: input.pickupUrlToken,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address_street: input.address.street,
    address_city: input.address.city,
    address_state: input.address.state,
    address_zip: input.address.zip,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    active: input.active,
  };
}

export function officePatchToDbUpdate(
  patch: Partial<Omit<Office, "id">>,
): DbOfficeUpdate {
  const out: DbOfficeUpdate = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.slug !== undefined) out.slug = patch.slug;
  if (patch.pickupUrlToken !== undefined)
    out.pickup_url_token = patch.pickupUrlToken;
  if (patch.phone !== undefined) out.phone = patch.phone ?? null;
  if (patch.email !== undefined) out.email = patch.email ?? null;
  if (patch.address !== undefined) {
    out.address_street = patch.address.street;
    out.address_city = patch.address.city;
    out.address_state = patch.address.state;
    out.address_zip = patch.address.zip;
  }
  if (patch.lat !== undefined) out.lat = patch.lat ?? null;
  if (patch.lng !== undefined) out.lng = patch.lng ?? null;
  if (patch.active !== undefined) out.active = patch.active;
  return out;
}

// ---------- Drivers -----------------------------------------------------

export interface DbDriverProfileFragment {
  full_name: string;
  phone: string | null;
}

export interface DbDriverRow {
  profile_id: string;
  vehicle_label: string | null;
  active: boolean;
  created_at: string;
  profiles: DbDriverProfileFragment | null;
}

export function dbDriverToDriver(row: DbDriverRow): Driver {
  return {
    profileId: row.profile_id,
    fullName: row.profiles?.full_name ?? "",
    phone: row.profiles?.phone ?? undefined,
    vehicleLabel: row.vehicle_label ?? undefined,
    active: row.active,
    createdAt: row.created_at,
  };
}

/**
 * Split of a driver patch into the two underlying tables. Callers run the
 * appropriate update(s); empty objects mean "skip that table".
 */
export interface DriverPatchSplit {
  driver: { vehicle_label?: string | null; active?: boolean };
  profile: { full_name?: string; phone?: string | null };
}

export function driverPatchToDbUpdate(
  patch: Partial<Omit<Driver, "profileId" | "createdAt">>,
): DriverPatchSplit {
  const out: DriverPatchSplit = { driver: {}, profile: {} };
  if (patch.fullName !== undefined) out.profile.full_name = patch.fullName;
  if (patch.phone !== undefined) out.profile.phone = patch.phone ?? null;
  if (patch.vehicleLabel !== undefined)
    out.driver.vehicle_label = patch.vehicleLabel ?? null;
  if (patch.active !== undefined) out.driver.active = patch.active;
  return out;
}

// ---------- Doctors -----------------------------------------------------

export interface DbDoctorRow {
  id: string;
  office_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
}

export type DbDoctorInsert = Omit<DbDoctorRow, "id" | "created_at">;
export type DbDoctorUpdate = Partial<Omit<DbDoctorRow, "id" | "created_at">>;

export function dbDoctorToDoctor(row: DbDoctorRow): Doctor {
  return {
    id: row.id,
    officeId: row.office_id,
    name: row.name,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
  };
}

export function doctorToDbInsert(input: NewDoctor): DbDoctorInsert {
  return {
    office_id: input.officeId,
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
  };
}

export function doctorPatchToDbUpdate(
  patch: Partial<Omit<Doctor, "id">>,
): DbDoctorUpdate {
  const out: DbDoctorUpdate = {};
  if (patch.officeId !== undefined) out.office_id = patch.officeId;
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.phone !== undefined) out.phone = patch.phone ?? null;
  if (patch.email !== undefined) out.email = patch.email ?? null;
  return out;
}

// ---------- Pickup requests --------------------------------------------

export interface DbPickupRequestRow {
  id: string;
  office_id: string | null;
  channel: PickupChannel;
  source_identifier: string | null;
  raw_message: string | null;
  urgency: PickupUrgency | null;
  sample_count: number | null;
  special_instructions: string | null;
  status: PickupStatus;
  flagged_reason: string | null;
  created_at: string;
  updated_at: string;
}

export type DbPickupRequestInsert = Omit<
  DbPickupRequestRow,
  "id" | "created_at" | "updated_at"
>;

export type DbPickupRequestUpdate = Partial<
  Omit<DbPickupRequestRow, "id" | "created_at">
>;

export function dbPickupRequestToPickupRequest(
  row: DbPickupRequestRow,
): PickupRequest {
  return {
    id: row.id,
    officeId: row.office_id ?? undefined,
    channel: row.channel,
    urgency: row.urgency ?? "routine",
    sampleCount: row.sample_count ?? undefined,
    specialInstructions: row.special_instructions ?? undefined,
    sourceIdentifier: row.source_identifier ?? undefined,
    flaggedReason: row.flagged_reason ?? undefined,
    rawMessage: row.raw_message ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function pickupRequestToDbInsert(
  input: NewPickupRequest,
): DbPickupRequestInsert {
  return {
    office_id: input.officeId ?? null,
    channel: input.channel,
    source_identifier: input.sourceIdentifier ?? null,
    raw_message: input.rawMessage ?? null,
    urgency: input.urgency,
    sample_count: input.sampleCount ?? null,
    special_instructions: input.specialInstructions ?? null,
    status: input.status ?? "pending",
    flagged_reason: input.flaggedReason ?? null,
  };
}

// ---------- Routes -----------------------------------------------------

export interface DbRouteRow {
  id: string;
  driver_id: string;
  route_date: string;
  status: RouteStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type DbRouteInsert = Omit<DbRouteRow, "id" | "created_at">;
export type DbRouteUpdate = Partial<Omit<DbRouteRow, "id" | "created_at">>;

export function dbRouteToRoute(row: DbRouteRow): Route {
  return {
    id: row.id,
    driverId: row.driver_id,
    routeDate: row.route_date,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
  };
}

export function routeToDbInsert(input: NewRoute): DbRouteInsert {
  return {
    driver_id: input.driverId,
    route_date: input.routeDate,
    status: "pending",
    started_at: null,
    completed_at: null,
  };
}

// ---------- Stops -----------------------------------------------------

export interface DbStopRow {
  id: string;
  route_id: string;
  pickup_request_id: string;
  position: number;
  eta_at: string | null;
  arrived_at: string | null;
  picked_up_at: string | null;
  notified_10min: boolean;
  created_at: string;
}

export type DbStopInsert = Omit<DbStopRow, "id" | "created_at">;
export type DbStopUpdate = Partial<Omit<DbStopRow, "id" | "created_at">>;

export function dbStopToStop(row: DbStopRow): Stop {
  return {
    id: row.id,
    routeId: row.route_id,
    pickupRequestId: row.pickup_request_id,
    position: row.position,
    etaAt: row.eta_at ?? undefined,
    arrivedAt: row.arrived_at ?? undefined,
    pickedUpAt: row.picked_up_at ?? undefined,
    notified10min: row.notified_10min,
    createdAt: row.created_at,
  };
}

// ---------- Driver locations -------------------------------------------

export interface DbDriverLocationRow {
  id: number | string;
  driver_id: string;
  route_id: string | null;
  lat: number;
  lng: number;
  recorded_at: string;
}

export interface DbDriverLocationInsert {
  driver_id: string;
  route_id: string | null;
  lat: number;
  lng: number;
  recorded_at: string;
}

export function dbDriverLocationToDriverLocation(
  row: DbDriverLocationRow,
): DriverLocation {
  return {
    id: String(row.id),
    driverId: row.driver_id,
    routeId: row.route_id ?? undefined,
    lat: row.lat,
    lng: row.lng,
    recordedAt: row.recorded_at,
  };
}

export function driverLocationToDbInsert(
  input: NewDriverLocation,
  nowIso: string,
): DbDriverLocationInsert {
  return {
    driver_id: input.driverId,
    route_id: input.routeId ?? null,
    lat: input.lat,
    lng: input.lng,
    recorded_at: input.recordedAt ?? nowIso,
  };
}

// ---------- Messages --------------------------------------------------

export interface DbMessageRow {
  id: string;
  channel: PickupChannel;
  from_identifier: string;
  subject: string | null;
  body: string;
  received_at: string;
  pickup_request_id: string | null;
}

export type DbMessageInsert = Omit<DbMessageRow, "id">;

export function dbMessageToMessage(row: DbMessageRow): Message {
  return {
    id: row.id,
    channel: row.channel,
    fromIdentifier: row.from_identifier,
    subject: row.subject ?? undefined,
    body: row.body,
    receivedAt: row.received_at,
    pickupRequestId: row.pickup_request_id ?? undefined,
  };
}

export function messageToDbInsert(
  input: NewMessage,
  nowIso: string,
): DbMessageInsert {
  return {
    channel: input.channel,
    from_identifier: input.fromIdentifier,
    subject: input.subject ?? null,
    body: input.body,
    received_at: input.receivedAt ?? nowIso,
    pickup_request_id: input.pickupRequestId ?? null,
  };
}

// ---------- Error wrapper ---------------------------------------------

/**
 * Wraps a Supabase PostgREST error into a plain `Error` with a stable
 * message shape. Crucially:
 *
 *   - Includes ONLY `err.message` text (if present) after the context
 *     prefix. Never serializes or includes the input row, env values, or
 *     the err object itself.
 *   - Falls back to `err.code` when `err.message` is absent.
 *
 * Callers never pass secrets into `err` (PostgREST never round-trips
 * them), but this wrapper still avoids any reflection that could leak
 * them by accident.
 */
export function wrapSupabaseError(
  err: { code?: string; message?: string; details?: string } | null | undefined,
  context: string,
): Error {
  const code = err?.code ?? "unknown";
  const rawMessage = typeof err?.message === "string" ? err.message : "";
  // Redact anything that looks like a bearer/service-role token or a
  // full URL. Defense in depth — supabase-js does not normally echo
  // these, but this wrapper guarantees it.
  const safeMessage = rawMessage
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/eyJ[a-zA-Z0-9_.-]+/g, "[redacted-token]")
    .replace(/service[_-]?role[^\s]*/gi, "[redacted-secret]");
  const suffix = safeMessage.length > 0 ? `: ${safeMessage}` : "";
  return new Error(`${context} failed (code=${code})${suffix}`);
}
