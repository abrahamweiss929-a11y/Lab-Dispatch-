import { notFound } from "next/navigation";
import { AdminLayout } from "@/components/AdminLayout";
import { getServices } from "@/interfaces";
import { requireAdminSession } from "@/lib/require-admin";
import { EditDriverForm } from "./_components/EditDriverForm";

interface PageProps {
  params: { id: string };
}

export default async function EditDriverPage({ params }: PageProps) {
  requireAdminSession();
  const storage = getServices().storage;
  const [driver, accounts] = await Promise.all([
    storage.getDriver(params.id),
    storage.listDriverAccounts(),
  ]);
  if (!driver) {
    notFound();
  }
  const email =
    accounts.find((a) => a.profileId === driver.profileId)?.email ?? "";

  return (
    <AdminLayout title={`Edit driver: ${driver.fullName}`}>
      <EditDriverForm driver={driver} email={email} />
    </AdminLayout>
  );
}
