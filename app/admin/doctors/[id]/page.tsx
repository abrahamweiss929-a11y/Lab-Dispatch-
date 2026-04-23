import { notFound } from "next/navigation";
import { AdminLayout } from "@/components/AdminLayout";
import { getServices } from "@/interfaces";
import { requireAdminSession } from "@/lib/require-admin";
import { EditDoctorForm } from "./_components/EditDoctorForm";

interface PageProps {
  params: { id: string };
}

export default async function EditDoctorPage({ params }: PageProps) {
  await requireAdminSession();
  const storage = getServices().storage;
  const [doctor, offices] = await Promise.all([
    storage.getDoctor(params.id),
    storage.listOffices(),
  ]);
  if (!doctor) {
    notFound();
  }
  const officeOptions = offices.map((o) => ({ id: o.id, name: o.name }));

  return (
    <AdminLayout title={`Edit doctor: ${doctor.name}`}>
      <EditDoctorForm doctor={doctor} offices={officeOptions} />
    </AdminLayout>
  );
}
