import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import { getServices } from "@/interfaces";
import { formatShortDateTime } from "@/lib/dates";
import { requireAdminSession } from "@/lib/require-admin";
import { deactivateDriverAction } from "./actions";

export default async function DriversListPage() {
  await requireAdminSession();
  const storage = getServices().storage;
  const [drivers, accounts] = await Promise.all([
    storage.listDrivers(),
    storage.listDriverAccounts(),
  ]);
  const emailByProfile = new Map(
    accounts.map((a) => [a.profileId, a.email] as const),
  );

  return (
    <AdminLayout title="Drivers">
      <div className="toolbar">
        <p className="page-subtitle">
          {drivers.length} {drivers.length === 1 ? "driver" : "drivers"} total
        </p>
        <Link
          href="/admin/drivers/new"
          className="btn btn-primary"
        >
          New driver
        </Link>
      </div>

      {drivers.length === 0 ? (
        <p className="empty-state">
          No drivers yet. Create one to start dispatching pickups.
        </p>
      ) : (
        <div className="data-table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-4 py-2">Full name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Vehicle</th>
                <th className="px-4 py-2">Active</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {drivers.map((d) => {
                const email = emailByProfile.get(d.profileId) ?? "—";
                const rowClass = d.active ? "" : "opacity-50";
                return (
                  <tr key={d.profileId} className={rowClass}>
                    <td className="px-4 py-2 font-medium">{d.fullName}</td>
                    <td className="px-4 py-2">{email}</td>
                    <td className="px-4 py-2">{d.phone ?? "—"}</td>
                    <td className="px-4 py-2">{d.vehicleLabel ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className={d.active ? "badge badge-success" : "badge badge-neutral"}>
                        {d.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {formatShortDateTime(d.createdAt)}
                    </td>
                    <td className="flex gap-2 px-4 py-2">
                      <Link
                        href={`/admin/drivers/${d.profileId}`}
                        className="btn-link"
                      >
                        Edit
                      </Link>
                      {d.active ? (
                        <form
                          action={deactivateDriverAction.bind(
                            null,
                            d.profileId,
                          )}
                        >
                          <button
                            type="submit"
                            className="btn-danger"
                          >
                            Deactivate
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
