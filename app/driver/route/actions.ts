"use server";

import { revalidatePath } from "next/cache";
import { getServices } from "@/interfaces";
import { formatShortDateTime } from "@/lib/dates";
import { canDriverCheckInStop } from "@/lib/permissions";
import { requireDriverSession } from "@/lib/require-driver";
import type { SessionCookieValue } from "@/lib/session";

async function loadActiveStopForDriver(
  stopId: string,
  session: SessionCookieValue,
) {
  const storage = getServices().storage;
  const stop = await storage.getStop(stopId);
  if (!stop) {
    throw new Error(`stop ${stopId} not found`);
  }
  const route = await storage.getRoute(stop.routeId);
  if (!route) {
    throw new Error(`route ${stop.routeId} not found`);
  }
  // Delegate the role+ownership decision to the permissions module so
  // admins/dispatchers and other drivers are rejected through one source
  // of truth.
  if (
    !canDriverCheckInStop({
      role: session.role,
      profileId: session.userId,
      routeDriverId: route.driverId,
    })
  ) {
    throw new Error("not your stop");
  }
  if (route.status !== "active") {
    throw new Error("route not active");
  }
  return { stop, route };
}

export async function arriveAtStopAction(stopId: string): Promise<void> {
  const session = await requireDriverSession();
  await loadActiveStopForDriver(stopId, session);
  await getServices().storage.markStopArrived(stopId);
  revalidatePath("/driver/route");
  revalidatePath(`/driver/route/${stopId}`);
  revalidatePath("/driver");
}

export async function pickupStopAction(stopId: string): Promise<void> {
  const session = await requireDriverSession();
  const { stop, route } = await loadActiveStopForDriver(stopId, session);
  const services = getServices();
  const storage = services.storage;
  await storage.markStopPickedUp(stopId);

  // Best-effort SMS notification to the originating office. Silent
  // no-op when there's no office or no phone on file. Failures are
  // swallowed — the pickup has already succeeded; a Twilio outage must
  // not roll it back.
  try {
    const request = await storage.getPickupRequest(stop.pickupRequestId);
    const officeId = request?.officeId;
    if (officeId !== undefined) {
      const office = await storage.getOffice(officeId);
      if (
        office !== null &&
        office !== undefined &&
        office.phone !== undefined &&
        office.phone.length > 0
      ) {
        const pickedUpAt = formatShortDateTime(new Date().toISOString());
        await services.sms.sendSms({
          to: office.phone,
          body: `Lab Dispatch: samples picked up from ${office.name} at ${pickedUpAt}. En route to lab.`,
        });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("pickupStopAction: notification SMS failed", err);
  }

  // Auto-complete the route when every stop on it is now picked up.
  // Isolated in try/catch so an auto-complete failure is logged but does
  // not propagate — the pickup itself has already succeeded.
  try {
    const stops = await storage.listStops(route.id);
    if (stops.every((s) => Boolean(s.pickedUpAt))) {
      await storage.updateRouteStatus(route.id, "completed");
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("pickupStopAction: auto-complete failed", err);
  }

  revalidatePath("/driver/route");
  revalidatePath(`/driver/route/${stopId}`);
  revalidatePath("/driver");
}
