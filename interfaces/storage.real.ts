import "server-only";
import { getSupabaseAdminClient } from "./supabase-client";
import { todayIso } from "@/lib/dates";
import { normalizeUsPhone } from "@/lib/phone";
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
  type DbDriverLocationRow,
  type DbDriverRow,
  type DbMessageRow,
  type DbOfficeRow,
  type DbPickupRequestRow,
  type DbRouteRow,
  type DbStopRow,
} from "@/lib/supabase-mappers";
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
} from "./storage";
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

function nowIso(): string {
  return new Date().toISOString();
}

// Shared temporary seed password for newly-created drivers. Admins reset
// it via Supabase immediately after creation. Not a secret to protect —
// every new driver gets the same starter password until the onboarding
// flow (random password + reset email) lands in a follow-up. Flagged in
// BLOCKERS.md and BUILD_LOG.md.
const TEMPORARY_DRIVER_PASSWORD = "test1234";

/**
 * Returns the full set of StorageService methods backed by Supabase.
 * `sb()` is invoked per call so env-var errors surface on first use, not
 * at module load, matching the behavior of the stub that previously
 * lived in `storage.ts`.
 */
export function createRealStorageService(): StorageService {
  const sb = () => getSupabaseAdminClient();

  // ---------- Offices ---------------------------------------------------

  async function listOffices(): Promise<Office[]> {
    const { data, error } = await sb()
      .from("offices")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw wrapSupabaseError(error, "listOffices");
    return ((data ?? []) as DbOfficeRow[]).map(dbOfficeToOffice);
  }

  async function getOffice(id: string): Promise<Office | null> {
    const { data, error } = await sb()
      .from("offices")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "getOffice");
    return data ? dbOfficeToOffice(data as DbOfficeRow) : null;
  }

  async function findOfficeBySlugToken(
    slug: string,
    token: string,
  ): Promise<Office | null> {
    const { data, error } = await sb()
      .from("offices")
      .select("*")
      .eq("slug", slug)
      .eq("pickup_url_token", token)
      .eq("active", true)
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "findOfficeBySlugToken");
    return data ? dbOfficeToOffice(data as DbOfficeRow) : null;
  }

  async function createOffice(input: NewOffice): Promise<Office> {
    const { data, error } = await sb()
      .from("offices")
      .insert(officeToDbInsert(input))
      .select("*")
      .single();
    if (error) throw wrapSupabaseError(error, "createOffice");
    return dbOfficeToOffice(data as DbOfficeRow);
  }

  async function updateOffice(
    id: string,
    patch: Partial<Omit<Office, "id">>,
  ): Promise<Office> {
    const update = officePatchToDbUpdate(patch);
    const { data, error } = await sb()
      .from("offices")
      .update(update)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "updateOffice");
    if (!data) throw new Error(`office ${id} not found`);
    return dbOfficeToOffice(data as DbOfficeRow);
  }

  async function findOfficeByPhone(phone: string): Promise<Office | null> {
    const normalized = normalizeUsPhone(phone);
    if (normalized === null) return null;
    // First try an exact match on the normalized form — fast path when
    // stored phones are already E.164.
    const exact = await sb()
      .from("offices")
      .select("*")
      .eq("phone", normalized)
      .eq("active", true)
      .maybeSingle();
    if (exact.error) throw wrapSupabaseError(exact.error, "findOfficeByPhone");
    if (exact.data) return dbOfficeToOffice(exact.data as DbOfficeRow);
    // Fallback: full-scan the active offices and re-normalize each stored
    // phone so offices stored with loose formatting still match. Matches
    // the mock's semantics. Acceptable for v1 scale (~100 offices); a
    // functional index on normalized phone is tracked as a follow-up.
    const scan = await sb()
      .from("offices")
      .select("*")
      .eq("active", true);
    if (scan.error) throw wrapSupabaseError(scan.error, "findOfficeByPhone");
    for (const row of (scan.data ?? []) as DbOfficeRow[]) {
      if (row.phone === null) continue;
      if (normalizeUsPhone(row.phone) === normalized) {
        return dbOfficeToOffice(row);
      }
    }
    return null;
  }

  async function findOfficeByEmail(email: string): Promise<Office | null> {
    const needle = email.trim();
    if (needle.length === 0) return null;
    const { data, error } = await sb()
      .from("offices")
      .select("*")
      .ilike("email", needle)
      .eq("active", true)
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "findOfficeByEmail");
    return data ? dbOfficeToOffice(data as DbOfficeRow) : null;
  }

  // ---------- Drivers ---------------------------------------------------

  async function listDrivers(): Promise<Driver[]> {
    const { data, error } = await sb()
      .from("drivers")
      .select("profile_id, vehicle_label, active, created_at, profiles(full_name, phone)")
      .order("created_at", { ascending: true });
    if (error) throw wrapSupabaseError(error, "listDrivers");
    return ((data ?? []) as unknown as DbDriverRow[]).map(dbDriverToDriver);
  }

  async function getDriver(profileId: string): Promise<Driver | null> {
    const { data, error } = await sb()
      .from("drivers")
      .select("profile_id, vehicle_label, active, created_at, profiles(full_name, phone)")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "getDriver");
    return data ? dbDriverToDriver(data as unknown as DbDriverRow) : null;
  }

  async function createDriver(input: NewDriver): Promise<Driver> {
    // Multi-step, non-transactional across auth + Postgres. Rollback is
    // best-effort: if any step after `auth.admin.createUser` fails, we
    // attempt to delete the auth user we just created (and the profile
    // row if drivers-insert is the failing step, so the FK to profiles
    // is clean before we touch auth). If a rollback step itself fails,
    // we log a warning and still surface the ORIGINAL error — the
    // failed email will be unclaimable until an admin manually deletes
    // it via Supabase. Tracked in BLOCKERS.md.
    const createResult = await sb().auth.admin.createUser({
      email: input.email,
      password: TEMPORARY_DRIVER_PASSWORD,
      email_confirm: true,
    });
    if (createResult.error || !createResult.data?.user) {
      throw wrapSupabaseError(
        { code: "auth", message: createResult.error?.message },
        "createDriver (auth.admin.createUser)",
      );
    }
    const userId = createResult.data.user.id;

    const rollbackAuth = async (context: string): Promise<void> => {
      try {
        const delResult = await sb().auth.admin.deleteUser(userId);
        if (delResult.error) {
          console.warn(
            `createDriver rollback at ${context}: auth.admin.deleteUser returned error for user ${userId}`,
          );
        }
      } catch {
        console.warn(
          `createDriver rollback at ${context}: auth.admin.deleteUser threw for user ${userId}`,
        );
      }
    };

    const profInsert = await sb().from("profiles").insert({
      id: userId,
      role: "driver",
      full_name: input.fullName,
      phone: input.phone ?? null,
    });
    if (profInsert.error) {
      await rollbackAuth("profiles insert");
      throw wrapSupabaseError(
        profInsert.error,
        "createDriver (profiles insert)",
      );
    }

    const drvInsert = await sb()
      .from("drivers")
      .insert({
        profile_id: userId,
        vehicle_label: input.vehicleLabel ?? null,
        active: input.active,
      })
      .select(
        "profile_id, vehicle_label, active, created_at, profiles(full_name, phone)",
      )
      .single();
    if (drvInsert.error) {
      // Roll back profiles FIRST (drivers FK references profiles), then
      // auth. We delete profiles explicitly instead of relying on
      // `on delete cascade` so the rollback is deterministic even if the
      // auth delete fails partially.
      try {
        const profDel = await sb().from("profiles").delete().eq("id", userId);
        if (profDel.error) {
          console.warn(
            `createDriver rollback: profiles delete returned error for user ${userId}`,
          );
        }
      } catch {
        console.warn(
          `createDriver rollback: profiles delete threw for user ${userId}`,
        );
      }
      await rollbackAuth("drivers insert");
      throw wrapSupabaseError(
        drvInsert.error,
        "createDriver (drivers insert)",
      );
    }

    return dbDriverToDriver(drvInsert.data as unknown as DbDriverRow);
  }

  async function updateDriver(
    profileId: string,
    patch: Partial<Omit<Driver, "profileId" | "createdAt">>,
  ): Promise<Driver> {
    const split = driverPatchToDbUpdate(patch);

    if (Object.keys(split.profile).length > 0) {
      const { error } = await sb()
        .from("profiles")
        .update(split.profile)
        .eq("id", profileId);
      if (error) throw wrapSupabaseError(error, "updateDriver (profile)");
    }

    if (Object.keys(split.driver).length > 0) {
      const { error } = await sb()
        .from("drivers")
        .update(split.driver)
        .eq("profile_id", profileId);
      if (error) throw wrapSupabaseError(error, "updateDriver (driver)");
    }

    const refreshed = await getDriver(profileId);
    if (!refreshed) throw new Error(`driver ${profileId} not found`);
    return refreshed;
  }

  async function listDriverAccounts(): Promise<DriverAccountSummary[]> {
    const { data, error } = await sb()
      .from("drivers")
      .select("profile_id");
    if (error) throw wrapSupabaseError(error, "listDriverAccounts (drivers)");
    const driverIds = new Set(
      ((data ?? []) as Array<{ profile_id: string }>).map((r) => r.profile_id),
    );
    if (driverIds.size === 0) return [];

    const authResult = await sb().auth.admin.listUsers();
    if (authResult.error) {
      throw wrapSupabaseError(
        { code: "auth", message: authResult.error.message },
        "listDriverAccounts (auth)",
      );
    }
    const users = authResult.data?.users ?? [];
    const out: DriverAccountSummary[] = [];
    for (const user of users) {
      if (!user.id || !driverIds.has(user.id)) continue;
      if (!user.email) continue;
      out.push({ profileId: user.id, email: user.email });
    }
    return out.sort((a, b) => a.profileId.localeCompare(b.profileId));
  }

  // ---------- Doctors ---------------------------------------------------

  async function listDoctors(): Promise<Doctor[]> {
    const { data, error } = await sb()
      .from("doctors")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw wrapSupabaseError(error, "listDoctors");
    return ((data ?? []) as Parameters<typeof dbDoctorToDoctor>[0][]).map(
      dbDoctorToDoctor,
    );
  }

  async function getDoctor(id: string): Promise<Doctor | null> {
    const { data, error } = await sb()
      .from("doctors")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "getDoctor");
    return data
      ? dbDoctorToDoctor(data as Parameters<typeof dbDoctorToDoctor>[0])
      : null;
  }

  async function createDoctor(input: NewDoctor): Promise<Doctor> {
    const { data, error } = await sb()
      .from("doctors")
      .insert(doctorToDbInsert(input))
      .select("*")
      .single();
    if (error) throw wrapSupabaseError(error, "createDoctor");
    return dbDoctorToDoctor(data as Parameters<typeof dbDoctorToDoctor>[0]);
  }

  async function updateDoctor(
    id: string,
    patch: Partial<Omit<Doctor, "id">>,
  ): Promise<Doctor> {
    const update = doctorPatchToDbUpdate(patch);
    const { data, error } = await sb()
      .from("doctors")
      .update(update)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "updateDoctor");
    if (!data) throw new Error(`doctor ${id} not found`);
    return dbDoctorToDoctor(data as Parameters<typeof dbDoctorToDoctor>[0]);
  }

  async function deleteDoctor(id: string): Promise<void> {
    const { data, error } = await sb()
      .from("doctors")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "deleteDoctor");
    if (!data) throw new Error(`doctor ${id} not found`);
  }

  // ---------- Pickup requests ------------------------------------------

  async function listPickupRequests(
    filter?: ListPickupRequestsFilter,
  ): Promise<PickupRequest[]> {
    let q = sb().from("pickup_requests").select("*");
    if (filter?.status !== undefined) {
      q = q.eq("status", filter.status);
    }
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw wrapSupabaseError(error, "listPickupRequests");
    return ((data ?? []) as DbPickupRequestRow[]).map(
      dbPickupRequestToPickupRequest,
    );
  }

  async function getPickupRequest(id: string): Promise<PickupRequest | null> {
    const { data, error } = await sb()
      .from("pickup_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "getPickupRequest");
    return data
      ? dbPickupRequestToPickupRequest(data as DbPickupRequestRow)
      : null;
  }

  async function createPickupRequest(
    input: NewPickupRequest,
  ): Promise<PickupRequest> {
    const { data, error } = await sb()
      .from("pickup_requests")
      .insert(pickupRequestToDbInsert(input))
      .select("*")
      .single();
    if (error) throw wrapSupabaseError(error, "createPickupRequest");
    return dbPickupRequestToPickupRequest(data as DbPickupRequestRow);
  }

  async function updatePickupRequestStatus(
    id: string,
    status: PickupStatus,
    flaggedReason?: string,
  ): Promise<PickupRequest> {
    // flagged_reason semantics:
    //   - status === "flagged": keep existing reason unless caller passes a new one.
    //   - any other status: clear the reason.
    let resolvedFlaggedReason: string | null = null;
    if (status === "flagged") {
      if (flaggedReason !== undefined) {
        resolvedFlaggedReason = flaggedReason;
      } else {
        const existing = await getPickupRequest(id);
        if (!existing) throw new Error(`pickup request ${id} not found`);
        resolvedFlaggedReason = existing.flaggedReason ?? null;
      }
    }

    const { data, error } = await sb()
      .from("pickup_requests")
      .update({
        status,
        flagged_reason: resolvedFlaggedReason,
        updated_at: nowIso(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "updatePickupRequestStatus");
    if (!data) throw new Error(`pickup request ${id} not found`);
    return dbPickupRequestToPickupRequest(data as DbPickupRequestRow);
  }

  // ---------- Routes ----------------------------------------------------

  async function listRoutes(filter?: ListRoutesFilter): Promise<Route[]> {
    let q = sb().from("routes").select("*");
    if (filter?.date !== undefined) q = q.eq("route_date", filter.date);
    if (filter?.driverId !== undefined) q = q.eq("driver_id", filter.driverId);
    if (filter?.status !== undefined) q = q.eq("status", filter.status);
    const { data, error } = await q.order("created_at", { ascending: true });
    if (error) throw wrapSupabaseError(error, "listRoutes");
    return ((data ?? []) as DbRouteRow[]).map(dbRouteToRoute);
  }

  async function getRoute(id: string): Promise<Route | null> {
    const { data, error } = await sb()
      .from("routes")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "getRoute");
    return data ? dbRouteToRoute(data as DbRouteRow) : null;
  }

  async function createRoute(input: NewRoute): Promise<Route> {
    const { data, error } = await sb()
      .from("routes")
      .insert(routeToDbInsert(input))
      .select("*")
      .single();
    if (error) throw wrapSupabaseError(error, "createRoute");
    return dbRouteToRoute(data as DbRouteRow);
  }

  async function updateRouteStatus(
    id: string,
    status: RouteStatus,
  ): Promise<Route> {
    const existing = await getRoute(id);
    if (!existing) throw new Error(`route ${id} not found`);
    const now = nowIso();
    const patch: {
      status: RouteStatus;
      started_at?: string | null;
      completed_at?: string | null;
    } = { status };
    if (status === "active") {
      if (!existing.startedAt) patch.started_at = now;
    } else if (status === "completed") {
      if (!existing.completedAt) patch.completed_at = now;
    } else if (status === "pending") {
      patch.started_at = null;
      patch.completed_at = null;
    }
    const { data, error } = await sb()
      .from("routes")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "updateRouteStatus");
    if (!data) throw new Error(`route ${id} not found`);
    return dbRouteToRoute(data as DbRouteRow);
  }

  // ---------- Stops -----------------------------------------------------

  async function listStops(routeId: string): Promise<Stop[]> {
    const { data, error } = await sb()
      .from("stops")
      .select("*")
      .eq("route_id", routeId)
      .order("position", { ascending: true });
    if (error) throw wrapSupabaseError(error, "listStops");
    return ((data ?? []) as DbStopRow[]).map(dbStopToStop);
  }

  async function getStop(id: string): Promise<Stop | null> {
    const { data, error } = await sb()
      .from("stops")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "getStop");
    return data ? dbStopToStop(data as DbStopRow) : null;
  }

  async function assignRequestToRoute(
    routeId: string,
    pickupRequestId: string,
    position?: number,
  ): Promise<Stop> {
    // Multi-step compound operation; NOT atomic at v1. UNIQUE
    // constraints on `(route_id, position)` and `(route_id,
    // pickup_request_id)` catch races at the DB layer.
    const route = await getRoute(routeId);
    if (!route) throw new Error(`route ${routeId} not found`);
    const request = await getPickupRequest(pickupRequestId);
    if (!request) throw new Error(`pickup request ${pickupRequestId} not found`);

    const existing = await sb()
      .from("stops")
      .select("id")
      .eq("pickup_request_id", pickupRequestId)
      .maybeSingle();
    if (existing.error) {
      throw wrapSupabaseError(existing.error, "assignRequestToRoute (existing)");
    }
    if (existing.data) throw new Error("pickup request already assigned");

    let nextPosition: number;
    if (position !== undefined) {
      const collision = await sb()
        .from("stops")
        .select("id")
        .eq("route_id", routeId)
        .eq("position", position)
        .maybeSingle();
      if (collision.error) {
        throw wrapSupabaseError(
          collision.error,
          "assignRequestToRoute (position collision)",
        );
      }
      if (collision.data) {
        throw new Error(`stop at position ${position} already exists`);
      }
      nextPosition = position;
    } else {
      const { data: maxPosRow, error: maxErr } = await sb()
        .from("stops")
        .select("position")
        .eq("route_id", routeId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxErr)
        throw wrapSupabaseError(maxErr, "assignRequestToRoute (max position)");
      const currentMax =
        (maxPosRow as { position: number } | null)?.position ?? 0;
      nextPosition = currentMax + 1;
    }

    const insertResult = await sb()
      .from("stops")
      .insert({
        route_id: routeId,
        pickup_request_id: pickupRequestId,
        position: nextPosition,
        notified_10min: false,
      })
      .select("*")
      .single();
    if (insertResult.error) {
      throw wrapSupabaseError(insertResult.error, "assignRequestToRoute (insert)");
    }

    const prUpdate = await sb()
      .from("pickup_requests")
      .update({ status: "assigned", updated_at: nowIso() })
      .eq("id", pickupRequestId);
    if (prUpdate.error) {
      throw wrapSupabaseError(
        prUpdate.error,
        "assignRequestToRoute (status flip)",
      );
    }

    return dbStopToStop(insertResult.data as DbStopRow);
  }

  async function removeStopFromRoute(stopId: string): Promise<void> {
    const stop = await getStop(stopId);
    if (!stop) throw new Error(`stop ${stopId} not found`);

    const del = await sb().from("stops").delete().eq("id", stopId);
    if (del.error)
      throw wrapSupabaseError(del.error, "removeStopFromRoute (delete)");

    const survivors = await listStops(stop.routeId);
    // Re-number contiguously 1..N. One UPDATE per survivor; acceptable
    // for v1 scale (stops per route are small). Tracked as a follow-up
    // to move to an RPC / single update with CASE.
    for (let i = 0; i < survivors.length; i++) {
      const target = survivors[i];
      const desired = i + 1;
      if (target.position === desired) continue;
      const u = await sb()
        .from("stops")
        .update({ position: desired })
        .eq("id", target.id);
      if (u.error)
        throw wrapSupabaseError(u.error, "removeStopFromRoute (renumber)");
    }

    const pr = await sb()
      .from("pickup_requests")
      .update({
        status: "pending",
        flagged_reason: null,
        updated_at: nowIso(),
      })
      .eq("id", stop.pickupRequestId);
    if (pr.error)
      throw wrapSupabaseError(pr.error, "removeStopFromRoute (status flip)");
  }

  async function reorderStops(
    routeId: string,
    orderedStopIds: string[],
  ): Promise<void> {
    const route = await getRoute(routeId);
    if (!route) throw new Error(`route ${routeId} not found`);
    const current = await listStops(routeId);
    if (orderedStopIds.length !== current.length) {
      throw new Error("orderedStopIds length does not match route stop count");
    }
    const currentIds = new Set(current.map((s) => s.id));
    for (const id of orderedStopIds) {
      const found = current.find((s) => s.id === id);
      if (!found) {
        if (!currentIds.has(id)) {
          // Check if it exists elsewhere or at all.
          const any = await getStop(id);
          if (!any) throw new Error(`stop ${id} not found`);
          if (any.routeId !== routeId)
            throw new Error(`stop ${id} does not belong to route ${routeId}`);
          throw new Error(`stop ${id} is not on route ${routeId}`);
        }
      }
    }
    for (let i = 0; i < orderedStopIds.length; i++) {
      const id = orderedStopIds[i];
      const desired = i + 1;
      const u = await sb()
        .from("stops")
        .update({ position: desired })
        .eq("id", id);
      if (u.error) throw wrapSupabaseError(u.error, "reorderStops");
    }
  }

  async function markStopArrived(stopId: string): Promise<Stop> {
    const stop = await getStop(stopId);
    if (!stop) throw new Error(`stop ${stopId} not found`);
    if (stop.arrivedAt) throw new Error(`stop ${stopId} already arrived`);
    const { data, error } = await sb()
      .from("stops")
      .update({ arrived_at: nowIso() })
      .eq("id", stopId)
      .select("*")
      .single();
    if (error) throw wrapSupabaseError(error, "markStopArrived");
    return dbStopToStop(data as DbStopRow);
  }

  async function markStopPickedUp(stopId: string): Promise<Stop> {
    const stop = await getStop(stopId);
    if (!stop) throw new Error(`stop ${stopId} not found`);
    if (!stop.arrivedAt) throw new Error(`stop ${stopId} not yet arrived`);
    if (stop.pickedUpAt) throw new Error(`stop ${stopId} already picked up`);
    const { data, error } = await sb()
      .from("stops")
      .update({ picked_up_at: nowIso() })
      .eq("id", stopId)
      .select("*")
      .single();
    if (error) throw wrapSupabaseError(error, "markStopPickedUp");
    return dbStopToStop(data as DbStopRow);
  }

  async function markStopNotified10min(stopId: string): Promise<Stop> {
    const stop = await getStop(stopId);
    if (!stop) throw new Error(`stop ${stopId} not found`);
    if (stop.notified10min) return stop;
    const { data, error } = await sb()
      .from("stops")
      .update({ notified_10min: true })
      .eq("id", stopId)
      .select("*")
      .single();
    if (error) throw wrapSupabaseError(error, "markStopNotified10min");
    return dbStopToStop(data as DbStopRow);
  }

  async function updateStopEta(
    stopId: string,
    etaAtIso: string,
  ): Promise<Stop> {
    const { data, error } = await sb()
      .from("stops")
      .update({ eta_at: etaAtIso })
      .eq("id", stopId)
      .select("*")
      .maybeSingle();
    if (error) throw wrapSupabaseError(error, "updateStopEta");
    if (!data) throw new Error(`stop ${stopId} not found`);
    return dbStopToStop(data as DbStopRow);
  }

  // ---------- Driver locations -----------------------------------------

  async function recordDriverLocation(
    input: NewDriverLocation,
  ): Promise<DriverLocation> {
    const { data, error } = await sb()
      .from("driver_locations")
      .insert(driverLocationToDbInsert(input, nowIso()))
      .select("*")
      .single();
    if (error) throw wrapSupabaseError(error, "recordDriverLocation");
    return dbDriverLocationToDriverLocation(data as DbDriverLocationRow);
  }

  async function listDriverLocations(
    filter?: ListDriverLocationsFilter,
  ): Promise<DriverLocation[]> {
    const sinceMinutes = filter?.sinceMinutes ?? 15;
    const cutoffIso = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
    const { data, error } = await sb()
      .from("driver_locations")
      .select("*")
      .gte("recorded_at", cutoffIso)
      .order("recorded_at", { ascending: false });
    if (error) throw wrapSupabaseError(error, "listDriverLocations");
    const rows = ((data ?? []) as DbDriverLocationRow[]).map(
      dbDriverLocationToDriverLocation,
    );
    // Dedupe to one row per driver (latest by recordedAt).
    const latest = new Map<string, DriverLocation>();
    for (const loc of rows) {
      const prev = latest.get(loc.driverId);
      if (!prev || prev.recordedAt < loc.recordedAt) {
        latest.set(loc.driverId, loc);
      }
    }
    return Array.from(latest.values()).sort((a, b) =>
      b.recordedAt.localeCompare(a.recordedAt),
    );
  }

  // ---------- Messages --------------------------------------------------

  async function listMessages(filter?: ListMessagesFilter): Promise<Message[]> {
    if (filter?.flagged === true) {
      // Messages with no pickup_request_id OR linked to a flagged request.
      const { data, error } = await sb()
        .from("messages")
        .select("*, pickup_requests(status)")
        .or("pickup_request_id.is.null,pickup_requests.status.eq.flagged")
        .order("received_at", { ascending: false });
      if (error) throw wrapSupabaseError(error, "listMessages (flagged)");
      return ((data ?? []) as DbMessageRow[]).map(dbMessageToMessage);
    }
    const { data, error } = await sb()
      .from("messages")
      .select("*")
      .order("received_at", { ascending: false });
    if (error) throw wrapSupabaseError(error, "listMessages");
    return ((data ?? []) as DbMessageRow[]).map(dbMessageToMessage);
  }

  async function createMessage(input: NewMessage): Promise<Message> {
    const { data, error } = await sb()
      .from("messages")
      .insert(messageToDbInsert(input, nowIso()))
      .select("*")
      .single();
    if (error) throw wrapSupabaseError(error, "createMessage");
    return dbMessageToMessage(data as DbMessageRow);
  }

  async function linkMessageToRequest(
    messageId: string,
    pickupRequestId: string,
  ): Promise<Message> {
    const existing = await sb()
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .maybeSingle();
    if (existing.error)
      throw wrapSupabaseError(existing.error, "linkMessageToRequest (read)");
    if (!existing.data) throw new Error(`message ${messageId} not found`);
    const current = existing.data as DbMessageRow;
    if (
      current.pickup_request_id !== null &&
      current.pickup_request_id !== pickupRequestId
    ) {
      throw new Error("message already linked");
    }
    const { data, error } = await sb()
      .from("messages")
      .update({ pickup_request_id: pickupRequestId })
      .eq("id", messageId)
      .select("*")
      .single();
    if (error) throw wrapSupabaseError(error, "linkMessageToRequest (update)");
    return dbMessageToMessage(data as DbMessageRow);
  }

  async function createRequestFromMessage(
    messageId: string,
  ): Promise<PickupRequest> {
    const existing = await sb()
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .maybeSingle();
    if (existing.error)
      throw wrapSupabaseError(existing.error, "createRequestFromMessage (read)");
    if (!existing.data) throw new Error(`message ${messageId} not found`);
    const msg = existing.data as DbMessageRow;
    if (msg.pickup_request_id !== null) {
      throw new Error("message already linked");
    }

    const newRequestResp = await sb()
      .from("pickup_requests")
      .insert({
        office_id: null,
        channel: msg.channel,
        source_identifier: msg.from_identifier,
        raw_message: msg.body,
        urgency: "routine",
        sample_count: null,
        special_instructions: null,
        status: "pending",
        flagged_reason: null,
      })
      .select("*")
      .single();
    if (newRequestResp.error) {
      throw wrapSupabaseError(
        newRequestResp.error,
        "createRequestFromMessage (insert)",
      );
    }
    const newRequest = dbPickupRequestToPickupRequest(
      newRequestResp.data as DbPickupRequestRow,
    );

    const linkResp = await sb()
      .from("messages")
      .update({ pickup_request_id: newRequest.id })
      .eq("id", messageId);
    if (linkResp.error) {
      throw wrapSupabaseError(
        linkResp.error,
        "createRequestFromMessage (link)",
      );
    }
    return newRequest;
  }

  // ---------- Dashboard counts -----------------------------------------

  async function countAdminDashboard(): Promise<AdminDashboardCounts> {
    const [driversRes, doctorsRes, officesRes, pendingRes] = await Promise.all([
      sb().from("drivers").select("*", { count: "exact", head: true }),
      sb().from("doctors").select("*", { count: "exact", head: true }),
      sb().from("offices").select("*", { count: "exact", head: true }),
      sb()
        .from("pickup_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);
    for (const r of [driversRes, doctorsRes, officesRes, pendingRes]) {
      if (r.error) throw wrapSupabaseError(r.error, "countAdminDashboard");
    }
    // `.select(..., { count: "exact", head: true })` returns count on the
    // response object. Cast explicitly to read it.
    const getCount = (r: { count?: number | null }): number => r.count ?? 0;
    return {
      drivers: getCount(driversRes as unknown as { count?: number | null }),
      doctors: getCount(doctorsRes as unknown as { count?: number | null }),
      offices: getCount(officesRes as unknown as { count?: number | null }),
      pendingPickupRequests: getCount(
        pendingRes as unknown as { count?: number | null },
      ),
    };
  }

  async function countDispatcherDashboard(
    dateIso?: string,
  ): Promise<DispatcherDashboardCounts> {
    const date = dateIso ?? todayIso();
    const [
      pendingRes,
      activeRoutesRes,
      routesForDateRes,
      flaggedMsgsRes,
    ] = await Promise.all([
      sb()
        .from("pickup_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      sb()
        .from("routes")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      sb().from("routes").select("id").eq("route_date", date),
      sb()
        .from("messages")
        .select("*, pickup_requests(status)", { count: "exact", head: true })
        .or("pickup_request_id.is.null,pickup_requests.status.eq.flagged"),
    ]);
    for (const r of [pendingRes, activeRoutesRes, routesForDateRes, flaggedMsgsRes]) {
      if (r.error) throw wrapSupabaseError(r.error, "countDispatcherDashboard");
    }
    const routeIds = ((routesForDateRes.data ?? []) as Array<{ id: string }>).map(
      (r) => r.id,
    );
    let todayStops = 0;
    if (routeIds.length > 0) {
      const stopsRes = await sb()
        .from("stops")
        .select("*", { count: "exact", head: true })
        .in("route_id", routeIds);
      if (stopsRes.error)
        throw wrapSupabaseError(stopsRes.error, "countDispatcherDashboard (stops)");
      todayStops =
        (stopsRes as unknown as { count?: number | null }).count ?? 0;
    }
    const getCount = (r: { count?: number | null }): number => r.count ?? 0;
    return {
      pendingRequests: getCount(
        pendingRes as unknown as { count?: number | null },
      ),
      todayStops,
      activeRoutes: getCount(
        activeRoutesRes as unknown as { count?: number | null },
      ),
      flaggedMessages: getCount(
        flaggedMsgsRes as unknown as { count?: number | null },
      ),
    };
  }

  return {
    listOffices,
    listDrivers,
    listDoctors,
    listPickupRequests,
    createOffice,
    createDriver,
    createDoctor,
    createPickupRequest,
    updatePickupRequestStatus,
    getOffice,
    findOfficeBySlugToken,
    updateOffice,
    getDriver,
    updateDriver,
    listDriverAccounts,
    getDoctor,
    updateDoctor,
    deleteDoctor,
    countAdminDashboard,
    listRoutes,
    getRoute,
    createRoute,
    updateRouteStatus,
    listStops,
    assignRequestToRoute,
    removeStopFromRoute,
    reorderStops,
    getStop,
    markStopArrived,
    markStopPickedUp,
    markStopNotified10min,
    updateStopEta,
    getPickupRequest,
    listDriverLocations,
    recordDriverLocation,
    listMessages,
    createRequestFromMessage,
    createMessage,
    findOfficeByPhone,
    findOfficeByEmail,
    linkMessageToRequest,
    countDispatcherDashboard,
  };
}
