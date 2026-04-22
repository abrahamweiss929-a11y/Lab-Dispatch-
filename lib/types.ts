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
}

export type PickupChannel = "sms" | "email" | "web" | "manual";
export type PickupUrgency = "routine" | "urgent" | "stat";
export type PickupStatus = "pending" | "assigned" | "completed" | "flagged";

export interface PickupRequest {
  id: string;
  officeId: string;
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

export interface Stop {
  id: string;
  routeId: string;
  pickupRequestId: string;
  officeId: string;
  sequence: number;
  etaAt?: string;
  arrivedAt?: string;
  pickedUpAt?: string;
}

export type RouteStatus = "draft" | "assigned" | "active" | "completed";

export interface Route {
  id: string;
  driverId: string;
  date: string;
  status: RouteStatus;
  startedAt?: string;
  completedAt?: string;
  stops: Stop[];
}
