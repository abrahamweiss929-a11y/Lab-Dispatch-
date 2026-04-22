export type UserRole = "driver" | "dispatcher" | "admin";

export interface Driver {
  profileId: string;
  fullName: string;
  phone?: string;
  vehicleLabel?: string;
  active: boolean;
  createdAt: string;
}

export interface Doctor {
  id: string;
  officeId: string;
  name: string;
  phone?: string;
  email?: string;
}

export interface OfficeAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface Office {
  id: string;
  name: string;
  slug: string;
  pickupUrlToken: string;
  address: OfficeAddress;
  lat?: number;
  lng?: number;
  phone?: string;
  email?: string;
  active: boolean;
}

export type PickupChannel = "sms" | "email" | "web" | "manual";
export type PickupUrgency = "routine" | "urgent" | "stat";
export type PickupStatus = "pending" | "assigned" | "completed" | "flagged";

export interface PickupRequest {
  id: string;
  /**
   * Nullable at the DB layer (`pickup_requests.office_id ... on delete set
   * null`). Requests created from a raw inbound `messages` row via
   * `createRequestFromMessage` start with no office — the dispatcher fills
   * it in later.
   */
  officeId?: string;
  channel: PickupChannel;
  urgency: PickupUrgency;
  sampleCount?: number;
  specialInstructions?: string;
  sourceIdentifier?: string;
  flaggedReason?: string;
  rawMessage?: string;
  status: PickupStatus;
  createdAt: string;
  updatedAt: string;
}

export type RouteStatus = "pending" | "active" | "completed";

export interface Route {
  id: string;
  driverId: string;
  /** "YYYY-MM-DD" — matches the SQL `date` column type. */
  routeDate: string;
  status: RouteStatus;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface Stop {
  id: string;
  routeId: string;
  pickupRequestId: string;
  /**
   * 1-based stop order within the route. Matches `stops.position`. The
   * schema enforces `unique (route_id, position)`.
   */
  position: number;
  etaAt?: string;
  arrivedAt?: string;
  pickedUpAt?: string;
  createdAt: string;
}

/**
 * Last-known GPS sample for a driver. Matches `public.driver_locations`.
 *
 * Note: the SQL column is `bigserial`, but the mock exposes it as a
 * `string` (stringified serial) to keep every id in the app one type. The
 * real Supabase adapter will stringify on the way out.
 */
export interface DriverLocation {
  id: string;
  driverId: string;
  routeId?: string;
  lat: number;
  lng: number;
  recordedAt: string;
}

/**
 * Inbound SMS / email landing in `public.messages`. The dispatcher reviews
 * these and either lets the AI-parsed pickup request stand or converts an
 * unparseable / unknown-sender row into a blank pending pickup request.
 */
export interface Message {
  id: string;
  channel: PickupChannel;
  fromIdentifier: string;
  subject?: string;
  body: string;
  receivedAt: string;
  pickupRequestId?: string;
}
