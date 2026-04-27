import { notFound } from "next/navigation";
import { AdminLayout } from "@/components/AdminLayout";
import { MapView, type MapPin } from "@/components/Map";
import { getServices } from "@/interfaces";
import { requireAdminSession } from "@/lib/require-admin";
import { EditOfficeForm } from "./_components/EditOfficeForm";

interface PageProps {
  params: { id: string };
}

export default async function EditOfficePage({ params }: PageProps) {
  await requireAdminSession();
  const office = await getServices().storage.getOffice(params.id);
  if (!office) {
    notFound();
  }

  const mapPins: MapPin[] =
    office.lat !== undefined && office.lng !== undefined
      ? [
          {
            id: office.id,
            lat: office.lat,
            lng: office.lng,
            color: office.active ? "#2563eb" : "#9ca3af",
            popup: `${office.name}\n${office.address.street}, ${office.address.city}, ${office.address.state} ${office.address.zip}`,
          },
        ]
      : [];

  return (
    <AdminLayout title={`Edit office: ${office.name}`}>
      {mapPins.length > 0 ? (
        <div className="mb-6">
          <MapView pins={mapPins} height="320px" />
        </div>
      ) : null}
      <EditOfficeForm office={office} />
    </AdminLayout>
  );
}
