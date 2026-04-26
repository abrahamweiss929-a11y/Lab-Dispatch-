import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import { getServices } from "@/interfaces";
import { requireAdminSession } from "@/lib/require-admin";

interface StatCardProps {
  label: string;
  value: number;
  href?: string;
  hint: string;
}

function StatCard({ label, value, href, hint }: StatCardProps) {
  const content = (
    <div className="stat-card transition">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      <p className="stat-hint">{hint}</p>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }
  // Pending pickups: no link yet. Links to dispatcher queue; wired when that
  // feature lands.
  return content;
}

export default async function AdminDashboardPage() {
  await requireAdminSession();
  const counts = await getServices().storage.countAdminDashboard();

  return (
    <AdminLayout title="Dashboard">
      <section className="relative mb-6 overflow-hidden rounded-lg bg-[var(--brand-950)] p-6 text-white shadow-[var(--shadow-soft)]">
        <div className="route-visual" aria-hidden="true">
          <span className="route-line route-line-one" />
          <span className="route-line route-line-two" />
          <span className="route-node route-node-a" />
          <span className="route-node route-node-b" />
          <span className="route-node route-node-c" />
        </div>
        <div className="relative max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-100/65">
            Operations setup
          </p>
          <h2 className="mt-3 text-2xl font-black leading-tight sm:text-3xl">
            Manage the people and places that make the network run.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/68">
            Keep driver rosters, doctor contacts, and office pickup links in
            one clean control surface.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Drivers"
          value={counts.drivers}
          href="/admin/drivers"
          hint="Field team"
        />
        <StatCard
          label="Doctors"
          value={counts.doctors}
          href="/admin/doctors"
          hint="Care contacts"
        />
        <StatCard
          label="Offices"
          value={counts.offices}
          href="/admin/offices"
          hint="Pickup sites"
        />
        <StatCard
          label="Pending pickups"
          value={counts.pendingPickupRequests}
          hint="Awaiting dispatch"
        />
      </div>
    </AdminLayout>
  );
}
