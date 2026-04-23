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
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {drivers.length} {drivers.length === 1 ? "driver" : "drivers"} total
        </p>
        <Link
          href="/admin/drivers/new"
          className="rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New driver
        </Link>
      </div>

      {drivers.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          No drivers yet. Create one to start dispatching pickups.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
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
                    <td className="px-4 py-2">{d.active ? "Yes" : "No"}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {formatShortDateTime(d.createdAt)}
                    </td>
                    <td className="flex gap-2 px-4 py-2">
                      <Link
                        href={`/admin/drivers/${d.profileId}`}
                        className="text-blue-600 hover:underline"
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
                            className="text-red-600 hover:underline"
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
