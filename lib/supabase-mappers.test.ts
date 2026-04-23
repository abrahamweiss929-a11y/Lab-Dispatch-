import { describe, it, expect } from "vitest";
import {
  dbDoctorToDoctor,
  dbDriverLocationToDriverLocation,
  dbDriverToDriver,
  dbMessageToMessage,
  dbOfficeToOffice,
  dbPickupRequestToPickupRequest,
  dbRouteToRoute,
  dbStopToStop,
  doctorPatchToDbUpdate,
  doctorToDbInsert,
  driverLocationToDbInsert,
  driverPatchToDbUpdate,
  messageToDbInsert,
  officePatchToDbUpdate,
  officeToDbInsert,
  pickupRequestToDbInsert,
  routeToDbInsert,
  wrapSupabaseError,
  type DbDoctorRow,
  type DbDriverLocationRow,
  type DbDriverRow,
  type DbMessageRow,
  type DbOfficeRow,
  type DbPickupRequestRow,
  type DbRouteRow,
  type DbStopRow,
} from "./supabase-mappers";
import type { NewDoctor, NewMessage, NewOffice, NewRoute } from "@/interfaces/storage";

describe("office mappers", () => {
  it("round-trips a fully populated office row → domain → insert", () => {
    const row: DbOfficeRow = {
      id: "office-1",
      name: "Maplewood Family Practice",
      slug: "maplewood",
      pickup_url_token: "abc123def456",
      phone: "+15551234567",
      email: "front@maplewood.test",
      address_street: "1 Main St",
      address_city: "Chicago",
      address_state: "IL",
      address_zip: "60601",
      lat: 41.88,
      lng: -87.62,
      active: true,
      created_at: "2026-01-01T00:00:00Z",
    };
    const domain = dbOfficeToOffice(row);
    expect(domain.phone).toBe("+15551234567");
    expect(domain.address.street).toBe("1 Main St");
    expect(domain.lat).toBe(41.88);

    const insert = officeToDbInsert({
      name: domain.name,
      slug: domain.slug,
      pickupUrlToken: domain.pickupUrlToken,
      phone: domain.phone,
      email: domain.email,
      address: domain.address,
      lat: domain.lat,
      lng: domain.lng,
      active: domain.active,
    });
    expect(insert.address_street).toBe("1 Main St");
    expect(insert.address_city).toBe("Chicago");
    expect(insert.phone).toBe("+15551234567");
    expect(insert.lat).toBe(41.88);
  });

  it("maps null columns to undefined on the domain side (phone, email, lat, lng)", () => {
    const row: DbOfficeRow = {
      id: "office-2",
      name: "Minimal Office",
      slug: "minimal",
      pickup_url_token: "tok123456789",
      phone: null,
      email: null,
      address_street: null,
      address_city: null,
      address_state: null,
      address_zip: null,
      lat: null,
      lng: null,
      active: true,
      created_at: "2026-01-01T00:00:00Z",
    };
    const domain = dbOfficeToOffice(row);
    expect(domain.phone).toBeUndefined();
    expect(domain.email).toBeUndefined();
    expect(domain.lat).toBeUndefined();
    expect(domain.lng).toBeUndefined();
    // Address fields fall back to empty string when all four are null.
    expect(domain.address.street).toBe("");
    expect(domain.address.city).toBe("");
    expect(domain.address.state).toBe("");
    expect(domain.address.zip).toBe("");
  });

  it("officeToDbInsert writes null for missing optional fields", () => {
    const input: NewOffice = {
      name: "Sparse",
      slug: "sparse",
      pickupUrlToken: "tok123456789",
      address: { street: "", city: "", state: "", zip: "" },
      active: true,
    };
    const insert = officeToDbInsert(input);
    expect(insert.phone).toBeNull();
    expect(insert.email).toBeNull();
    expect(insert.lat).toBeNull();
    expect(insert.lng).toBeNull();
  });

  it("officePatchToDbUpdate only writes provided keys and flattens address", () => {
    const patch = officePatchToDbUpdate({
      name: "New Name",
      address: { street: "2 Elm", city: "X", state: "IL", zip: "60601" },
    });
    expect(patch.name).toBe("New Name");
    expect(patch.address_street).toBe("2 Elm");
    expect(patch.address_city).toBe("X");
    // Absent keys stay absent.
    expect(patch.slug).toBeUndefined();
    expect(patch.phone).toBeUndefined();
  });
});

describe("driver mappers", () => {
  it("dbDriverToDriver reads joined profiles.full_name and profiles.phone", () => {
    const row: DbDriverRow = {
      profile_id: "p1",
      vehicle_label: "Van #1",
      active: true,
      created_at: "2026-01-01T00:00:00Z",
      profiles: { full_name: "Miguel", phone: "+15550001111" },
    };
    const driver = dbDriverToDriver(row);
    expect(driver.fullName).toBe("Miguel");
    expect(driver.phone).toBe("+15550001111");
    expect(driver.vehicleLabel).toBe("Van #1");
  });

  it("dbDriverToDriver maps null profiles.phone to undefined", () => {
    const row: DbDriverRow = {
      profile_id: "p1",
      vehicle_label: null,
      active: true,
      created_at: "2026-01-01T00:00:00Z",
      profiles: { full_name: "Terrance", phone: null },
    };
    const driver = dbDriverToDriver(row);
    expect(driver.phone).toBeUndefined();
    expect(driver.vehicleLabel).toBeUndefined();
  });

  it("driverPatchToDbUpdate splits the patch into profiles and drivers tables", () => {
    const split = driverPatchToDbUpdate({
      fullName: "New Name",
      phone: "+15559998888",
      vehicleLabel: "Van #9",
      active: false,
    });
    expect(split.profile.full_name).toBe("New Name");
    expect(split.profile.phone).toBe("+15559998888");
    expect(split.driver.vehicle_label).toBe("Van #9");
    expect(split.driver.active).toBe(false);
  });

  it("driverPatchToDbUpdate yields empty sides when no relevant keys are set", () => {
    const split = driverPatchToDbUpdate({});
    expect(Object.keys(split.profile)).toHaveLength(0);
    expect(Object.keys(split.driver)).toHaveLength(0);
  });
});

describe("doctor mappers", () => {
  it("round-trips a doctor row", () => {
    const row: DbDoctorRow = {
      id: "d1",
      office_id: "o1",
      name: "Dr. Chen",
      phone: "+15550002222",
      email: "chen@x.test",
      created_at: "2026-01-01T00:00:00Z",
    };
    const doc = dbDoctorToDoctor(row);
    expect(doc.name).toBe("Dr. Chen");
    expect(doc.officeId).toBe("o1");

    const insert = doctorToDbInsert({
      officeId: doc.officeId,
      name: doc.name,
      phone: doc.phone,
      email: doc.email,
    } as NewDoctor);
    expect(insert.office_id).toBe("o1");
    expect(insert.phone).toBe("+15550002222");
  });

  it("doctorPatchToDbUpdate handles undefined/null phone correctly", () => {
    const patch = doctorPatchToDbUpdate({ phone: undefined });
    expect(Object.keys(patch)).toHaveLength(0);

    const patch2 = doctorPatchToDbUpdate({ name: "X" });
    expect(patch2.name).toBe("X");
    expect(patch2.phone).toBeUndefined();
  });
});

describe("pickup request mappers", () => {
  it("round-trips a fully populated pickup request row", () => {
    const row: DbPickupRequestRow = {
      id: "pr1",
      office_id: "o1",
      channel: "web",
      source_identifier: "slugtoken",
      raw_message: "2 samples",
      urgency: "urgent",
      sample_count: 2,
      special_instructions: "ring back",
      status: "pending",
      flagged_reason: null,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    const pr = dbPickupRequestToPickupRequest(row);
    expect(pr.status).toBe("pending");
    expect(pr.urgency).toBe("urgent");
    expect(pr.sampleCount).toBe(2);
    expect(pr.specialInstructions).toBe("ring back");

    const insert = pickupRequestToDbInsert({
      officeId: pr.officeId,
      channel: pr.channel,
      urgency: pr.urgency,
      sampleCount: pr.sampleCount,
      specialInstructions: pr.specialInstructions,
      sourceIdentifier: pr.sourceIdentifier,
      rawMessage: pr.rawMessage,
    });
    expect(insert.office_id).toBe("o1");
    expect(insert.status).toBe("pending");
    expect(insert.urgency).toBe("urgent");
  });

  it("maps null office_id / urgency / flagged_reason to appropriate defaults", () => {
    const row: DbPickupRequestRow = {
      id: "pr2",
      office_id: null,
      channel: "sms",
      source_identifier: null,
      raw_message: null,
      urgency: null,
      sample_count: null,
      special_instructions: null,
      status: "flagged",
      flagged_reason: "ai_low_confidence",
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };
    const pr = dbPickupRequestToPickupRequest(row);
    expect(pr.officeId).toBeUndefined();
    expect(pr.urgency).toBe("routine");
    expect(pr.flaggedReason).toBe("ai_low_confidence");
    expect(pr.sampleCount).toBeUndefined();
  });
});

describe("route mappers", () => {
  it("round-trips a route row", () => {
    const row: DbRouteRow = {
      id: "r1",
      driver_id: "p1",
      route_date: "2026-04-22",
      status: "active",
      started_at: "2026-04-22T10:00:00Z",
      completed_at: null,
      created_at: "2026-04-22T09:00:00Z",
    };
    const route = dbRouteToRoute(row);
    expect(route.status).toBe("active");
    expect(route.startedAt).toBe("2026-04-22T10:00:00Z");
    expect(route.completedAt).toBeUndefined();

    const insert = routeToDbInsert({
      driverId: "p1",
      routeDate: "2026-04-22",
    } as NewRoute);
    expect(insert.status).toBe("pending");
    expect(insert.started_at).toBeNull();
    expect(insert.completed_at).toBeNull();
  });
});

describe("stop mappers", () => {
  it("dbStopToStop maps null eta/arrived/pickedUp to undefined", () => {
    const row: DbStopRow = {
      id: "s1",
      route_id: "r1",
      pickup_request_id: "pr1",
      position: 2,
      eta_at: null,
      arrived_at: null,
      picked_up_at: null,
      notified_10min: false,
      created_at: "2026-04-22T09:00:00Z",
    };
    const stop = dbStopToStop(row);
    expect(stop.position).toBe(2);
    expect(stop.etaAt).toBeUndefined();
    expect(stop.arrivedAt).toBeUndefined();
    expect(stop.pickedUpAt).toBeUndefined();
    expect(stop.notified10min).toBe(false);
  });
});

describe("driver location mappers", () => {
  it("stringifies a numeric bigserial id", () => {
    const row: DbDriverLocationRow = {
      id: 42,
      driver_id: "p1",
      route_id: "r1",
      lat: 41.88,
      lng: -87.62,
      recorded_at: "2026-04-22T10:00:00Z",
    };
    const loc = dbDriverLocationToDriverLocation(row);
    expect(loc.id).toBe("42");
    expect(typeof loc.id).toBe("string");
    expect(loc.routeId).toBe("r1");
  });

  it("maps null route_id to undefined", () => {
    const row: DbDriverLocationRow = {
      id: "7",
      driver_id: "p1",
      route_id: null,
      lat: 0,
      lng: 0,
      recorded_at: "2026-04-22T10:00:00Z",
    };
    const loc = dbDriverLocationToDriverLocation(row);
    expect(loc.routeId).toBeUndefined();
    expect(loc.id).toBe("7");
  });

  it("driverLocationToDbInsert falls back to nowIso when recordedAt is undefined", () => {
    const now = "2026-04-22T12:00:00Z";
    const insert = driverLocationToDbInsert(
      { driverId: "p1", lat: 1, lng: 2 },
      now,
    );
    expect(insert.recorded_at).toBe(now);
    expect(insert.route_id).toBeNull();
  });
});

describe("message mappers", () => {
  it("round-trips a message row", () => {
    const row: DbMessageRow = {
      id: "m1",
      channel: "sms",
      from_identifier: "+15550003333",
      subject: null,
      body: "3 samples please",
      received_at: "2026-04-22T09:00:00Z",
      pickup_request_id: null,
    };
    const msg = dbMessageToMessage(row);
    expect(msg.subject).toBeUndefined();
    expect(msg.pickupRequestId).toBeUndefined();

    const insert = messageToDbInsert(
      {
        channel: "sms",
        fromIdentifier: "+15550003333",
        body: "3 samples please",
      } as NewMessage,
      "2026-04-22T09:00:00Z",
    );
    expect(insert.received_at).toBe("2026-04-22T09:00:00Z");
    expect(insert.subject).toBeNull();
    expect(insert.pickup_request_id).toBeNull();
  });
});

describe("wrapSupabaseError", () => {
  it("includes the context prefix and the error code", () => {
    const wrapped = wrapSupabaseError(
      { code: "23505", message: "duplicate key" },
      "createOffice",
    );
    expect(wrapped.message).toContain("createOffice failed");
    expect(wrapped.message).toContain("23505");
  });

  it("falls back to 'unknown' when no code present", () => {
    const wrapped = wrapSupabaseError({ message: "x" }, "listOffices");
    expect(wrapped.message).toContain("code=unknown");
  });

  it("never leaks a fake URL embedded in err.message", () => {
    const wrapped = wrapSupabaseError(
      {
        code: "PGRST301",
        message:
          "failed to reach https://leaky.supabase.co/rest/v1/offices?select=*",
      },
      "listOffices",
    );
    expect(wrapped.message).not.toContain("https://leaky.supabase.co");
    expect(wrapped.message).toContain("[redacted-url]");
  });

  it("never leaks a service_role token fragment embedded in err.message", () => {
    const wrapped = wrapSupabaseError(
      {
        code: "PGRST301",
        message:
          "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
      },
      "listOffices",
    );
    expect(wrapped.message).not.toContain("eyJhbGci");
    expect(wrapped.message).toContain("[redacted-token]");
  });

  it("never leaks the literal 'service_role' string", () => {
    const wrapped = wrapSupabaseError(
      { code: "42501", message: "role service_role cannot do X" },
      "createDoctor",
    );
    expect(wrapped.message).not.toContain("service_role");
    expect(wrapped.message).toContain("[redacted-secret]");
  });

  it("tolerates null/undefined error input", () => {
    const wrapped = wrapSupabaseError(null, "x");
    expect(wrapped.message).toContain("x failed");
    expect(wrapped.message).toContain("code=unknown");
  });
});
