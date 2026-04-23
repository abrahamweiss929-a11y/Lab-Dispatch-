import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { todayIso } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import { NewRouteForm } from "./_components/NewRouteForm";

export default async function NewRoutePage() {
  await requireDispatcherSession();
  const drivers = await getServices().storage.listDrivers();
  const options = drivers
    .filter((d) => d.active)
    .map((d) => ({ profileId: d.profileId, fullName: d.fullName }));

  return (
    <DispatcherLayout title="New route">
      <NewRouteForm drivers={options} defaultDate={todayIso()} />
    </DispatcherLayout>
  );
}
