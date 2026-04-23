import Link from "next/link";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { formatShortDateTime, todayIso } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import type { PickupRequest, Route } from "@/lib/types";
import { AssignToRouteSelect } from "./_components/AssignToRouteSelect";
import { FlagForReviewButton } from "./_components/FlagForReviewButton";
import { MarkResolvedButton } from "./_components/MarkResolvedButton";

type FilterTab = "pending" | "flagged" | "all";

const FILTER_TABS: Array<{ value: FilterTab; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "flagged", label: "Flagged" },
  { value: "all", label: "All" },
];

interface SearchParams {
  filter?: string;
}

function parseFilter(raw?: string): FilterTab {
  if (raw === "flagged" || raw === "all") return raw;
  return "pending";
}

function isCreatedToday(r: PickupRequest, today: string): boolean {
  return r.createdAt.startsWith(today);
}

function passesStatusFilter(r: PickupRequest, filter: FilterTab): boolean {
  if (filter === "pending") return r.status === "pending";
  if (filter === "flagged") return r.status === "flagged";
  return true;
}

function routeLabel(route: Route, driverName: string | undefined): string {
  const name = driverName ?? "Unknown driver";
  return `${name} · ${route.status}`;
}

export default async function DispatcherRequestsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  await requireDispatcherSession();
  const filter = parseFilter(searchParams?.filter);
  const today = todayIso();

  const storage = getServices().storage;
  const [allRequests, offices, routes, drivers] = await Promise.all([
    storage.listPickupRequests(),
    storage.listOffices(),
    storage.listRoutes({ date: today }),
    storage.listDrivers(),
  ]);

  const officeById = new Map(offices.map((o) => [o.id, o] as const));
  const driverNameById = new Map(
    drivers.map((d) => [d.profileId, d.fullName] as const),
  );
  const routeOptions = routes.map((r) => ({
    id: r.id,
    label: routeLabel(r, driverNameById.get(r.driverId)),
  }));

  const rows = allRequests
    .filter((r) => isCreatedToday(r, today))
    .filter((r) => passesStatusFilter(r, filter));

  return (
    <DispatcherLayout title="Today's requests">
      <div className="mb-4 flex items-center justify-between">
        <nav className="flex gap-1 rounded bg-gray-100 p-1 text-sm">
          {FILTER_TABS.map((tab) => {
            const active = tab.value === filter;
            return (
              <Link
                key={tab.value}
                href={
                  tab.value === "pending"
                    ? "/dispatcher/requests"
                    : `/dispatcher/requests?filter=${tab.value}`
                }
                className={
                  active
                    ? "rounded bg-white px-3 py-1 font-medium shadow-sm"
                    : "rounded px-3 py-1 text-gray-600 hover:bg-white"
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/dispatcher/requests/new"
          className="rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New manual request
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          No requests today in this view.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2">Channel</th>
                <th className="px-4 py-2">From</th>
                <th className="px-4 py-2">Urgency</th>
                <th className="px-4 py-2">Samples</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((r) => {
                const office = r.officeId
                  ? officeById.get(r.officeId)
                  : undefined;
                const fromLabel = office
                  ? office.name
                  : r.sourceIdentifier && r.sourceIdentifier.length > 0
                    ? r.sourceIdentifier
                    : "Unknown";
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      {formatShortDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-2">{r.channel}</td>
                    <td className="px-4 py-2">{fromLabel}</td>
                    <td className="px-4 py-2">{r.urgency}</td>
                    <td className="px-4 py-2">{r.sampleCount ?? "—"}</td>
                    <td className="px-4 py-2">{r.status}</td>
                    <td className="flex flex-wrap items-center gap-3 px-4 py-2">
                      <AssignToRouteSelect
                        requestId={r.id}
                        routes={routeOptions}
                      />
                      {r.status !== "flagged" ? (
                        <FlagForReviewButton requestId={r.id} />
                      ) : null}
                      {r.status !== "completed" ? (
                        <MarkResolvedButton requestId={r.id} />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </DispatcherLayout>
  );
}
