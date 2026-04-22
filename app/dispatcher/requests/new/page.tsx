import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import { NewManualRequestForm } from "./_components/NewManualRequestForm";

export default async function NewManualRequestPage() {
  requireDispatcherSession();
  const offices = await getServices().storage.listOffices();
  const options = offices
    .filter((o) => o.active)
    .map((o) => ({ id: o.id, name: o.name }));

  return (
    <DispatcherLayout title="New manual request">
      <NewManualRequestForm offices={options} />
    </DispatcherLayout>
  );
}
