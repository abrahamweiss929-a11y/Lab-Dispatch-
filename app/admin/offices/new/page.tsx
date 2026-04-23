import { AdminLayout } from "@/components/AdminLayout";
import { requireAdminSession } from "@/lib/require-admin";
import { NewOfficeForm } from "./_components/NewOfficeForm";

export default async function NewOfficePage() {
  await requireAdminSession();
  return (
    <AdminLayout title="New office">
      <NewOfficeForm />
    </AdminLayout>
  );
}
