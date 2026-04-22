import Link from "next/link";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { todayIso } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";

interface StatCardProps {
  label: string;
  value: number;
  href: string;
}

function StatCard({ label, value, href }: StatCardProps) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md"
    >
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
    </Link>
  );
}

export default async function DispatcherDashboardPage() {
  requireDispatcherSession();
  const counts = await getServices().storage.countDispatcherDashboard(
    todayIso(),
  );

  return (
    <DispatcherLayout title="Dashboard">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pending requests"
          value={counts.pendingRequests}
          href="/dispatcher/requests"
        />
        <StatCard
          label="Today's stops"
          value={counts.todayStops}
          href="/dispatcher/routes"
        />
        <StatCard
          label="Active routes"
          value={counts.activeRoutes}
          href="/dispatcher/routes?status=active"
        />
        <StatCard
          label="Flagged messages"
          value={counts.flaggedMessages}
          href="/dispatcher/messages?filter=flagged"
        />
      </div>
    </DispatcherLayout>
  );
}
