import { AdminLayout } from "@/components/AdminLayout";
import { requireAdminSession } from "@/lib/require-admin";
import { NewDriverForm } from "./_components/NewDriverForm";

export default async function NewDriverPage() {
  await requireAdminSession();
  return (
    <AdminLayout title="New driver">
      <NewDriverForm />
    </AdminLayout>
  );
}
