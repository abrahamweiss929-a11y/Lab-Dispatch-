import Link from "next/link";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { todayIso } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";

interface StatCardProps {
  label: string;
  value: number;
  href: string;
  hint: string;
}

function StatCard({ label, value, href, hint }: StatCardProps) {
  return (
    <Link
      href={href}
      className="stat-card block transition"
    >
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      <p className="stat-hint">{hint}</p>
    </Link>
  );
}

export default async function DispatcherDashboardPage() {
  await requireDispatcherSession();
  const counts = await getServices().storage.countDispatcherDashboard(
    todayIso(),
  );

  return (
    <DispatcherLayout title="Dashboard">
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
            Morning command center
          </p>
          <h2 className="mt-3 text-2xl font-black leading-tight sm:text-3xl">
            Keep pickups moving from request to route to driver.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/68">
            Requests, messages, routes, and driver pings are grouped into one
            dispatch board so the next action is always visible.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pending requests"
          value={counts.pendingRequests}
          href="/dispatcher/requests"
          hint="Needs routing"
        />
        <StatCard
          label="Today's stops"
          value={counts.todayStops}
          href="/dispatcher/routes"
          hint="On the board"
        />
        <StatCard
          label="Active routes"
          value={counts.activeRoutes}
          href="/dispatcher/routes?status=active"
          hint="Drivers rolling"
        />
        <StatCard
          label="Flagged messages"
          value={counts.flaggedMessages}
          href="/dispatcher/messages?filter=flagged"
          hint="Needs review"
        />
      </div>
    </DispatcherLayout>
  );
}
