import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { todayIso } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import { resolveSenderDisplay } from "@/lib/sender-display";
import {
  NewRouteForm,
  type PendingRequestOption,
} from "./_components/NewRouteForm";

export default async function NewRoutePage() {
  await requireDispatcherSession();
  const storage = getServices().storage;
  const [drivers, allRequests, offices, doctors] = await Promise.all([
    storage.listDrivers(),
    storage.listPickupRequests({ status: "pending" }),
    storage.listOffices(),
    storage.listDoctors(),
  ]);

  const driverOptions = drivers
    .filter((d) => d.active)
    .map((d) => ({ profileId: d.profileId, fullName: d.fullName }));

  const officeById = new Map(offices.map((o) => [o.id, o] as const));

  const requestOptions: PendingRequestOption[] = allRequests.map((r) => {
    let senderLabel: string;
    if (r.officeId) {
      const office = officeById.get(r.officeId);
      senderLabel = office?.name ?? "Unknown office";
    } else if (r.sourceIdentifier && r.sourceIdentifier.length > 0) {
      const display = resolveSenderDisplay(
        r.sourceIdentifier,
        offices,
        doctors,
      );
      senderLabel = display.kind === "match" ? display.officeName : display.raw;
    } else {
      senderLabel = "Unknown sender";
    }
    return {
      id: r.id,
      senderLabel,
      urgency: r.urgency,
      sampleCount: r.sampleCount,
    };
  });

  return (
    <DispatcherLayout title="New route">
      <NewRouteForm
        drivers={driverOptions}
        defaultDate={todayIso()}
        pendingRequests={requestOptions}
      />
    </DispatcherLayout>
  );
}
