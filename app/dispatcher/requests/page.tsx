import Link from "next/link";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { formatShortDateTime, todayIso } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import {
  resolveSenderDisplay,
  type SenderDisplay,
} from "@/lib/sender-display";
import type { Office, PickupRequest, Route } from "@/lib/types";
import { SenderCell } from "../_components/SenderCell";
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

/**
 * Build a SenderDisplay for a pickup request. Prefers the office FK
 * (most accurate; works even when sourceIdentifier is empty/manual);
 * falls back to resolving the raw sourceIdentifier against offices/
 * doctors; ultimately to "unknown".
 */
function senderForRequest(
  r: PickupRequest,
  officeById: Map<string, Office>,
  offices: readonly Office[],
  doctors: readonly import("@/lib/types").Doctor[],
): SenderDisplay {
  if (r.officeId) {
    const office = officeById.get(r.officeId);
    if (office) {
      // Look for a doctor whose contact matches the source identifier
      // — gives us the doctor name when one is on file.
      if (r.sourceIdentifier && r.sourceIdentifier.length > 0) {
        const candidateDoctors = doctors.filter(
          (d) => d.officeId === office.id,
        );
        const resolved = resolveSenderDisplay(
          r.sourceIdentifier,
          [office],
          candidateDoctors,
        );
        if (resolved.kind === "match") return resolved;
      }
      return {
        kind: "match",
        officeName: office.name,
        address: office.address,
      };
    }
  }
  if (r.sourceIdentifier && r.sourceIdentifier.length > 0) {
    return resolveSenderDisplay(r.sourceIdentifier, offices, doctors);
  }
  return { kind: "unknown", raw: "(no sender on file)" };
}

function statusBadgeClass(status: PickupRequest["status"]): string {
  if (status === "completed") return "badge badge-success";
  if (status === "flagged") return "badge badge-danger";
  if (status === "assigned") return "badge badge-info";
  return "badge badge-warning";
}

function urgencyBadgeClass(urgency: PickupRequest["urgency"]): string {
  if (urgency === "stat") return "badge badge-danger";
  if (urgency === "urgent") return "badge badge-warning";
  return "badge badge-neutral";
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
  const [allRequests, offices, routes, drivers, doctors] = await Promise.all([
    storage.listPickupRequests(),
    storage.listOffices(),
    storage.listRoutes({ date: today }),
    storage.listDrivers(),
    storage.listDoctors(),
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
      <div className="toolbar">
        <nav className="segmented-nav">
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
                    ? "segmented-link segmented-link-active"
                    : "segmented-link"
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/dispatcher/requests/new"
          className="btn btn-primary"
        >
          New manual request
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="empty-state">
          No requests today in this view.
        </p>
      ) : (
        <div className="data-table-shell">
          <table className="data-table">
            <thead>
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
                const sender = senderForRequest(r, officeById, offices, doctors);
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      {formatShortDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-2">
                      <span className="badge badge-info">{r.channel}</span>
                    </td>
                    <td className="px-4 py-2">
                      <SenderCell display={sender} />
                    </td>
                    <td className="px-4 py-2">
                      <span className={urgencyBadgeClass(r.urgency)}>
                        {r.urgency}
                      </span>
                    </td>
                    <td className="px-4 py-2">{r.sampleCount ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className={statusBadgeClass(r.status)}>
                        {r.status}
                      </span>
                    </td>
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
