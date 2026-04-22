/**
 * Demo fixtures for the mock storage layer. `seedMocks()` populates the
 * mock with 6 offices, 10 doctors, 4 drivers (3 named demo drivers + 1
 * bound to the `driver@test` auth session), 20 pickup requests spread
 * across all four channels and all four statuses, 5 inbound messages, 2
 * routes for today, and a trail of driver GPS pings.
 *
 * The seeder writes ONLY to the in-memory mock — no external services
 * are touched. See `interfaces/index.ts` for the auto-seed hook that
 * runs `seedMocks()` at most once per process (skipped under
 * `NODE_ENV=test` and when `SEED_MOCKS=false`).
 */
import { makeRandomId } from "@/lib/ids";
import { todayIso } from "@/lib/dates";
import {
  seedDoctor,
  seedDriver,
  seedDriverLocation,
  seedMessage,
  seedOffice,
  seedPickupRequest,
  seedRoute,
  seedStop,
} from "@/mocks/storage";
import type {
  Doctor,
  Driver,
  DriverLocation,
  Message,
  Office,
  OfficeAddress,
  PickupRequest,
  Route,
  Stop,
} from "@/lib/types";

const GLOBAL_FLAG_KEY = "__labDispatchSeeded";

interface GlobalWithFlag {
  [GLOBAL_FLAG_KEY]?: boolean;
}

function globalFlagStore(): GlobalWithFlag {
  return globalThis as unknown as GlobalWithFlag;
}

/** Returns true after `seedMocks()` has run at least once this process. */
export function isSeeded(): boolean {
  return globalFlagStore()[GLOBAL_FLAG_KEY] === true;
}

/**
 * Clears the "already seeded" flag. Test/seed-only — after a
 * `resetAllMocks()` call, tests that want to re-seed must first call
 * this to let `seedMocks()` run again.
 */
export function resetSeedFlag(): void {
  globalFlagStore()[GLOBAL_FLAG_KEY] = false;
}

function minutesAgoIso(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

function hoursAgoIso(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60_000).toISOString();
}

function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60_000).toISOString();
}

function makeOffice(input: Omit<Office, "id">): Office {
  return { id: makeRandomId(), ...input };
}

function makeDoctor(input: Omit<Doctor, "id">): Doctor {
  return { id: makeRandomId(), ...input };
}

function makeDriver(input: Omit<Driver, "createdAt">, createdAt: string): Driver {
  return { ...input, createdAt };
}

/**
 * Populates the mock storage with demo fixtures. Idempotent: second and
 * subsequent calls no-op until `resetSeedFlag()` is called. Safe to call
 * on already-populated storage only when the flag is true — if storage
 * was cleared externally (e.g. `resetAllMocks()` in a test) without
 * resetting the flag, this will silently skip re-seeding. Callers that
 * need to re-seed after a reset must call `resetSeedFlag()` first.
 */
export function seedMocks(): void {
  if (isSeeded()) return;

  const now = new Date();
  const today = todayIso();

  // ---- Offices -----------------------------------------------------------
  // Chicago-area metro for coherent lat/lng. Office #4 is phoneless,
  // office #6 is soft-deleted (active=false) to exercise `findOfficeBy*`
  // filtering.
  const addrChicago = (street: string, zip: string): OfficeAddress => ({
    street,
    city: "Chicago",
    state: "IL",
    zip,
  });

  const officeLincoln = makeOffice({
    name: "Lincoln Park Pediatrics",
    slug: "lincoln-park-ped",
    pickupUrlToken: "a1b2c3d4e5f6",
    address: addrChicago("2500 N Lincoln Ave", "60614"),
    lat: 41.9214,
    lng: -87.6513,
    phone: "+13125550101",
    email: "front@lincolnparkped.test",
    active: true,
  });
  const officeNearNorth = makeOffice({
    name: "Near North Family Medicine",
    slug: "near-north-fam",
    pickupUrlToken: "b2c3d4e5f6a1",
    address: addrChicago("220 W Huron St", "60654"),
    lat: 41.8998,
    lng: -87.6347,
    phone: "+13125550102",
    email: "office@nnfm.test",
    active: true,
  });
  const officeWestLoop = makeOffice({
    name: "West Loop Internal Medicine",
    slug: "west-loop-im",
    pickupUrlToken: "c3d4e5f6a1b2",
    address: addrChicago("900 W Randolph St", "60607"),
    lat: 41.8827,
    lng: -87.6593,
    phone: "+13125550103",
    email: "hello@wlim.test",
    active: true,
  });
  const officeLoganSq = makeOffice({
    name: "Logan Square Cardiology",
    slug: "logan-sq-cardio",
    pickupUrlToken: "d4e5f6a1b2c3",
    address: addrChicago("2600 N Milwaukee Ave", "60647"),
    lat: 41.9291,
    lng: -87.7085,
    // phone intentionally omitted (exercises phoneless-office branch).
    email: "office@lscardio.test",
    active: true,
  });
  const officeEvanston = makeOffice({
    name: "Evanston Labs Associates",
    slug: "evanston-labs",
    pickupUrlToken: "e5f6a1b2c3d4",
    address: {
      street: "1700 Central St",
      city: "Evanston",
      state: "IL",
      zip: "60201",
    },
    lat: 42.0451,
    lng: -87.6877,
    phone: "+18475550105",
    email: "labs@evanstonassoc.test",
    active: true,
  });
  const officeOakPark = makeOffice({
    name: "Oak Park Internists (closed)",
    slug: "oak-park-int",
    pickupUrlToken: "f6a1b2c3d4e5",
    address: {
      street: "1000 Lake St",
      city: "Oak Park",
      state: "IL",
      zip: "60301",
    },
    lat: 41.885,
    lng: -87.7845,
    phone: "+17085550106",
    email: "contact@opint.test",
    active: false,
  });

  [
    officeLincoln,
    officeNearNorth,
    officeWestLoop,
    officeLoganSq,
    officeEvanston,
    officeOakPark,
  ].forEach(seedOffice);

  // ---- Doctors -----------------------------------------------------------
  const doctors: Doctor[] = [
    makeDoctor({
      officeId: officeLincoln.id,
      name: "Dr. Amy Chen",
      phone: "+13125550111",
      email: "chen@lincolnparkped.test",
    }),
    makeDoctor({
      officeId: officeLincoln.id,
      name: "Dr. Marcus Patel",
      phone: "+13125550112",
      email: "patel@lincolnparkped.test",
    }),
    makeDoctor({
      officeId: officeLincoln.id,
      name: "Dr. Sofia Reyes",
      phone: "+13125550113",
      email: "reyes@lincolnparkped.test",
    }),
    makeDoctor({
      officeId: officeNearNorth.id,
      name: "Dr. Jamal Okafor",
      phone: "+13125550121",
      email: "okafor@nnfm.test",
    }),
    makeDoctor({
      officeId: officeNearNorth.id,
      name: "Dr. Hannah Weiss",
      phone: "+13125550122",
      email: "weiss@nnfm.test",
    }),
    makeDoctor({
      officeId: officeWestLoop.id,
      name: "Dr. Daniel Brooks",
      phone: "+13125550131",
      email: "brooks@wlim.test",
    }),
    makeDoctor({
      officeId: officeWestLoop.id,
      name: "Dr. Priya Shah",
      phone: "+13125550132",
      email: "shah@wlim.test",
    }),
    makeDoctor({
      officeId: officeLoganSq.id,
      name: "Dr. Evelyn Torres",
      phone: "+13125550141",
      email: "torres@lscardio.test",
    }),
    makeDoctor({
      officeId: officeEvanston.id,
      name: "Dr. Kenji Watanabe",
      phone: "+18475550151",
      email: "watanabe@evanstonassoc.test",
    }),
    makeDoctor({
      officeId: officeEvanston.id,
      name: "Dr. Ruth Feldman",
      phone: "+18475550152",
      email: "feldman@evanstonassoc.test",
    }),
  ];
  doctors.forEach(seedDoctor);

  // ---- Drivers -----------------------------------------------------------
  // 4 rows: 3 named demo drivers + 1 bound to the `driver@test` session
  // (userId `user-driver` in mocks/auth.ts). The session-bound driver is
  // the one with today's active route so `/driver/route` shows stops.
  const miguelProfileId = "user-driver";
  const miguel = makeDriver(
    {
      profileId: miguelProfileId,
      fullName: "Miguel Ortega",
      phone: "+13125559001",
      vehicleLabel: "Van 1 (white Transit)",
      active: true,
    },
    daysAgoIso(now, 90),
  );
  seedDriver(miguel, "miguel@lab.test");

  const alicia = makeDriver(
    {
      profileId: makeRandomId(),
      fullName: "Alicia Brooks",
      phone: "+13125559002",
      vehicleLabel: "Van 2 (blue Sprinter)",
      active: true,
    },
    daysAgoIso(now, 60),
  );
  seedDriver(alicia, "alicia@lab.test");

  const terrance = makeDriver(
    {
      profileId: makeRandomId(),
      fullName: "Terrance Wells",
      phone: "+13125559003",
      vehicleLabel: "Van 3 (retired)",
      active: false,
    },
    daysAgoIso(now, 180),
  );
  seedDriver(terrance, "terrance@lab.test");

  const casey = makeDriver(
    {
      profileId: makeRandomId(),
      fullName: "Casey Rivera",
      phone: "+13125559004",
      vehicleLabel: "Van 4 (spare)",
      active: true,
    },
    daysAgoIso(now, 30),
  );
  seedDriver(casey, "casey@lab.test");

  // ---- Pickup requests ---------------------------------------------------
  // 20 total distributed: 6 pending / 8 assigned / 4 completed / 2 flagged.
  // By channel: 8 web / 6 sms / 4 email / 2 manual.
  // By urgency: 14 routine / 4 urgent / 2 stat.
  // Spread `createdAt` across the last 30 days.
  const requests: PickupRequest[] = [];

  function addPr(input: Omit<PickupRequest, "id" | "updatedAt">): PickupRequest {
    const record: PickupRequest = {
      id: makeRandomId(),
      ...input,
      updatedAt: input.createdAt,
    };
    seedPickupRequest(record);
    requests.push(record);
    return record;
  }

  // --- Web (8): 2 pending, 4 assigned, 1 completed, 1 flagged ---
  addPr({
    officeId: officeLincoln.id,
    channel: "web",
    urgency: "routine",
    sampleCount: 3,
    specialInstructions: "Leave at front desk with receptionist.",
    status: "pending",
    createdAt: hoursAgoIso(now, 1),
  });
  addPr({
    officeId: officeWestLoop.id,
    channel: "web",
    urgency: "urgent",
    sampleCount: 5,
    specialInstructions: "Doctor needs turnaround by 3 PM.",
    status: "pending",
    createdAt: hoursAgoIso(now, 4),
  });
  const webAssigned1 = addPr({
    officeId: officeNearNorth.id,
    channel: "web",
    urgency: "routine",
    sampleCount: 2,
    status: "assigned",
    createdAt: hoursAgoIso(now, 8),
  });
  const webAssigned2 = addPr({
    officeId: officeLincoln.id,
    channel: "web",
    urgency: "routine",
    sampleCount: 4,
    status: "assigned",
    createdAt: daysAgoIso(now, 1),
  });
  const webAssigned3 = addPr({
    officeId: officeEvanston.id,
    channel: "web",
    urgency: "stat",
    sampleCount: 1,
    specialInstructions: "STAT — patient waiting.",
    status: "assigned",
    createdAt: hoursAgoIso(now, 3),
  });
  const webAssigned4 = addPr({
    officeId: officeLoganSq.id,
    channel: "web",
    urgency: "routine",
    sampleCount: 2,
    status: "assigned",
    createdAt: hoursAgoIso(now, 2),
  });
  addPr({
    officeId: officeWestLoop.id,
    channel: "web",
    urgency: "routine",
    sampleCount: 6,
    status: "completed",
    createdAt: daysAgoIso(now, 3),
  });
  addPr({
    officeId: officeNearNorth.id,
    channel: "web",
    urgency: "urgent",
    sampleCount: 3,
    status: "flagged",
    flaggedReason: "Office asked us to call before pickup.",
    createdAt: daysAgoIso(now, 5),
  });

  // --- SMS (6): 2 pending, 3 assigned, 1 completed ---
  const smsPendingWithCount = addPr({
    channel: "sms",
    urgency: "routine",
    officeId: officeLincoln.id,
    sourceIdentifier: "+13125550101",
    rawMessage: "Pickup please, 4 samples ready at reception",
    sampleCount: 4,
    status: "pending",
    createdAt: minutesAgoIso(now, 45),
  });
  // 1 SMS with no parsed sampleCount (AI low confidence).
  addPr({
    channel: "sms",
    urgency: "routine",
    officeId: officeEvanston.id,
    sourceIdentifier: "+18475550105",
    rawMessage: "got a few for you",
    status: "pending",
    createdAt: hoursAgoIso(now, 6),
  });
  const smsAssignedUrgent = addPr({
    channel: "sms",
    urgency: "urgent",
    officeId: officeLincoln.id,
    sourceIdentifier: "+13125550101",
    rawMessage: "Need urgent pickup, 2 samples",
    sampleCount: 2,
    status: "assigned",
    createdAt: hoursAgoIso(now, 5),
  });
  const smsAssigned2 = addPr({
    channel: "sms",
    urgency: "routine",
    officeId: officeNearNorth.id,
    sourceIdentifier: "+13125550102",
    rawMessage: "3 samples ready",
    sampleCount: 3,
    status: "assigned",
    createdAt: daysAgoIso(now, 2),
  });
  // 1 more SMS with no parsed sampleCount.
  const smsAssigned3 = addPr({
    channel: "sms",
    urgency: "routine",
    officeId: officeWestLoop.id,
    sourceIdentifier: "+13125550103",
    rawMessage: "pickup tomorrow thx",
    status: "assigned",
    createdAt: hoursAgoIso(now, 10),
  });
  addPr({
    channel: "sms",
    urgency: "routine",
    officeId: officeLincoln.id,
    sourceIdentifier: "+13125550101",
    rawMessage: "ready for pickup, 8 samples",
    sampleCount: 8,
    status: "completed",
    createdAt: daysAgoIso(now, 7),
  });

  // --- Email (4): 1 pending, 1 assigned, 1 completed, 1 flagged ---
  const emailPending = addPr({
    channel: "email",
    urgency: "routine",
    officeId: officeNearNorth.id,
    sourceIdentifier: "office@nnfm.test",
    rawMessage: "Please collect 5 samples Thursday afternoon.",
    sampleCount: 5,
    status: "pending",
    createdAt: daysAgoIso(now, 1),
  });
  addPr({
    channel: "email",
    urgency: "stat",
    officeId: officeLincoln.id,
    sourceIdentifier: "front@lincolnparkped.test",
    rawMessage: "STAT pickup for patient Doe, 1 sample.",
    sampleCount: 1,
    specialInstructions: "STAT patient Doe.",
    status: "assigned",
    createdAt: hoursAgoIso(now, 9),
  });
  addPr({
    channel: "email",
    urgency: "routine",
    officeId: officeEvanston.id,
    sourceIdentifier: "labs@evanstonassoc.test",
    rawMessage: "Pickup done Monday, thanks.",
    sampleCount: 10,
    status: "completed",
    createdAt: daysAgoIso(now, 14),
  });
  // Email with no officeId (orphaned parse).
  addPr({
    channel: "email",
    urgency: "routine",
    sourceIdentifier: "noreply@someclinic.test",
    rawMessage: "Hi can we get a pickup Thursday?",
    status: "flagged",
    flaggedReason: "Unknown sender — needs dispatcher review.",
    createdAt: daysAgoIso(now, 22),
  });

  // --- Manual (2): 1 pending, 1 completed ---
  addPr({
    channel: "manual",
    urgency: "urgent",
    officeId: officeWestLoop.id,
    specialInstructions: "Called in by Dr. Brooks, 7 samples.",
    sampleCount: 7,
    status: "pending",
    createdAt: daysAgoIso(now, 2),
  });
  addPr({
    channel: "manual",
    urgency: "routine",
    officeId: officeLoganSq.id,
    specialInstructions: "Phone-in request from front desk.",
    sampleCount: 2,
    status: "completed",
    createdAt: daysAgoIso(now, 28),
  });

  // ---- Routes + Stops ----------------------------------------------------
  // Route A: Miguel (user-driver), active, 5 stops. First 2 completed,
  // stop 3 on-site (arrived, not picked up), stops 4-5 upcoming.
  const routeAId = makeRandomId();
  const routeAStartedAt = minutesAgoIso(now, 90);
  const routeA: Route = {
    id: routeAId,
    driverId: miguelProfileId,
    routeDate: today,
    status: "active",
    startedAt: routeAStartedAt,
    createdAt: hoursAgoIso(now, 2),
  };
  seedRoute(routeA);

  const routeARequestIds = [
    webAssigned1.id,
    webAssigned2.id,
    webAssigned3.id,
    smsAssignedUrgent.id,
    smsAssigned2.id,
  ];
  routeARequestIds.forEach((requestId, idx) => {
    const position = idx + 1;
    const isCompleted = position <= 2;
    const isOnSite = position === 3;
    const arrivedMinutesAgo = 90 - position * 15;
    const pickedUpMinutesAgo = Math.max(arrivedMinutesAgo - 5, 1);
    const stop: Stop = {
      id: makeRandomId(),
      routeId: routeAId,
      pickupRequestId: requestId,
      position,
      notified10min: position <= 3,
      arrivedAt:
        isCompleted || isOnSite
          ? minutesAgoIso(now, arrivedMinutesAgo)
          : undefined,
      pickedUpAt: isCompleted ? minutesAgoIso(now, pickedUpMinutesAgo) : undefined,
      createdAt: hoursAgoIso(now, 2),
    };
    seedStop(stop);
  });

  // Route B: Alicia, pending, 3 stops. Nothing checked in.
  const routeBId = makeRandomId();
  const routeB: Route = {
    id: routeBId,
    driverId: alicia.profileId,
    routeDate: today,
    status: "pending",
    createdAt: hoursAgoIso(now, 1),
  };
  seedRoute(routeB);

  const routeBRequestIds = [
    webAssigned4.id,
    smsAssigned3.id,
    // 8th assigned is the email STAT above — fetch by filter.
    requests.find(
      (r) => r.channel === "email" && r.status === "assigned",
    )?.id,
  ].filter((id): id is string => typeof id === "string");
  routeBRequestIds.forEach((requestId, idx) => {
    const stop: Stop = {
      id: makeRandomId(),
      routeId: routeBId,
      pickupRequestId: requestId,
      position: idx + 1,
      notified10min: false,
      createdAt: hoursAgoIso(now, 1),
    };
    seedStop(stop);
  });

  // ---- Driver locations --------------------------------------------------
  // 10 pings along Route A's path, spaced 90s apart going backward from
  // now. Keeps the latest within the default `sinceMinutes=15` window.
  const locationPath: Array<{ lat: number; lng: number }> = [
    { lat: 41.9214, lng: -87.6513 },
    { lat: 41.915, lng: -87.648 },
    { lat: 41.91, lng: -87.645 },
    { lat: 41.905, lng: -87.642 },
    { lat: 41.9, lng: -87.638 },
    { lat: 41.895, lng: -87.635 },
    { lat: 41.8998, lng: -87.6347 },
    { lat: 41.895, lng: -87.645 },
    { lat: 41.89, lng: -87.652 },
    { lat: 41.8827, lng: -87.6593 },
  ];
  locationPath.forEach((point, idx) => {
    const secondsAgo = (locationPath.length - 1 - idx) * 90;
    const loc: DriverLocation = {
      id: String(idx + 1),
      driverId: miguelProfileId,
      routeId: routeAId,
      lat: point.lat,
      lng: point.lng,
      recordedAt: new Date(now.getTime() - secondsAgo * 1000).toISOString(),
    };
    seedDriverLocation(loc);
  });

  // ---- Messages ----------------------------------------------------------
  // 3 linked to pickup requests above + 2 orphans (unknown senders).
  const linkedSmsMsg1: Message = {
    id: makeRandomId(),
    channel: "sms",
    fromIdentifier: "+13125550101",
    body: "Pickup please, 4 samples ready at reception",
    receivedAt: minutesAgoIso(now, 45),
    pickupRequestId: smsPendingWithCount.id,
  };
  seedMessage(linkedSmsMsg1);

  const linkedSmsMsg2: Message = {
    id: makeRandomId(),
    channel: "sms",
    fromIdentifier: "+13125550101",
    body: "Need urgent pickup, 2 samples",
    receivedAt: hoursAgoIso(now, 5),
    pickupRequestId: smsAssignedUrgent.id,
  };
  seedMessage(linkedSmsMsg2);

  const linkedEmailMsg: Message = {
    id: makeRandomId(),
    channel: "email",
    fromIdentifier: "office@nnfm.test",
    subject: "Pickup Thursday",
    body: "Please collect 5 samples Thursday afternoon.",
    receivedAt: daysAgoIso(now, 1),
    pickupRequestId: emailPending.id,
  };
  seedMessage(linkedEmailMsg);

  const orphanSmsMsg: Message = {
    id: makeRandomId(),
    channel: "sms",
    fromIdentifier: "+16305554444",
    body: "Pickup tomorrow at 9? Thx",
    receivedAt: hoursAgoIso(now, 7),
  };
  seedMessage(orphanSmsMsg);

  const orphanEmailMsg: Message = {
    id: makeRandomId(),
    channel: "email",
    fromIdentifier: "noreply@someclinic.test",
    subject: "Pickup request",
    body: "Hi, can we get a pickup Thursday?",
    receivedAt: daysAgoIso(now, 1),
  };
  seedMessage(orphanEmailMsg);

  globalFlagStore()[GLOBAL_FLAG_KEY] = true;
}
