import { AdminLayout } from "@/components/AdminLayout";
import { getServices } from "@/interfaces";
import { requireAdminSession } from "@/lib/require-admin";
import { NewDoctorForm } from "./_components/NewDoctorForm";

export default async function NewDoctorPage() {
  requireAdminSession();
  const offices = await getServices().storage.listOffices();
  const officeOptions = offices.map((o) => ({ id: o.id, name: o.name }));

  return (
    <AdminLayout title="New doctor">
      <NewDoctorForm offices={officeOptions} />
    </AdminLayout>
  );
}
