import { notFound } from "next/navigation";
import { AdminLayout } from "@/components/AdminLayout";
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

  return (
    <AdminLayout title={`Edit office: ${office.name}`}>
      <EditOfficeForm office={office} />
    </AdminLayout>
  );
}
