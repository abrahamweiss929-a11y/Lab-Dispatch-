import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import { getServices } from "@/interfaces";
import { requireAdminSession } from "@/lib/require-admin";

interface StatCardProps {
  label: string;
  value: number;
  href?: string;
}

function StatCard({ label, value, href }: StatCardProps) {
  const content = (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block hover:shadow-md">
        {content}
      </Link>
    );
  }
  // Pending pickups: no link yet. Links to dispatcher queue; wired when that
  // feature lands.
  return content;
}

export default async function AdminDashboardPage() {
  requireAdminSession();
  const counts = await getServices().storage.countAdminDashboard();

  return (
    <AdminLayout title="Dashboard">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Drivers"
          value={counts.drivers}
          href="/admin/drivers"
        />
        <StatCard
          label="Doctors"
          value={counts.doctors}
          href="/admin/doctors"
        />
        <StatCard
          label="Offices"
          value={counts.offices}
          href="/admin/offices"
        />
        <StatCard
          label="Pending pickups"
          value={counts.pendingPickupRequests}
        />
      </div>
    </AdminLayout>
  );
}
