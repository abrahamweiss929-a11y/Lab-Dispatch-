import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import { getServices } from "@/interfaces";
import { requireAdminSession } from "@/lib/require-admin";
import { deactivateOfficeAction } from "./actions";

export default async function OfficesListPage() {
  requireAdminSession();
  const offices = await getServices().storage.listOffices();

  return (
    <AdminLayout title="Offices">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {offices.length} {offices.length === 1 ? "office" : "offices"} total
        </p>
        <Link
          href="/admin/offices/new"
          className="rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New office
        </Link>
      </div>

      {offices.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          No offices yet. Add one to start routing pickups.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Slug</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Location</th>
                <th className="px-4 py-2">Active</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {offices.map((o) => {
                const rowClass = o.active ? "" : "opacity-50";
                return (
                  <tr key={o.id} className={rowClass}>
                    <td className="px-4 py-2 font-medium">{o.name}</td>
                    <td className="px-4 py-2 font-mono text-xs">{o.slug}</td>
                    <td className="px-4 py-2">{o.phone ?? "—"}</td>
                    <td className="px-4 py-2">{o.email ?? "—"}</td>
                    <td className="px-4 py-2">
                      {o.address.city}, {o.address.state}
                    </td>
                    <td className="px-4 py-2">{o.active ? "Yes" : "No"}</td>
                    <td className="flex gap-2 px-4 py-2">
                      <Link
                        href={`/admin/offices/${o.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        Edit
                      </Link>
                      {o.active ? (
                        <form
                          action={deactivateOfficeAction.bind(null, o.id)}
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
