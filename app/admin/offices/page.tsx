import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import type { MapPin } from "@/components/Map";
import { getServices } from "@/interfaces";
import { requireAdminSession } from "@/lib/require-admin";
import { deactivateOfficeAction } from "./actions";
import { OfficesMap } from "./_components/OfficesMap";

export default async function OfficesListPage() {
  await requireAdminSession();
  const offices = await getServices().storage.listOffices();

  const mapPins: MapPin[] = offices
    .filter((o) => o.lat !== undefined && o.lng !== undefined)
    .map((o) => ({
      id: o.id,
      lat: o.lat as number,
      lng: o.lng as number,
      color: o.active ? "#2563eb" : "#9ca3af",
      popup: `${o.name}\n${o.address.street}, ${o.address.city}, ${o.address.state} ${o.address.zip}`,
    }));

  return (
    <AdminLayout title="Offices">
      {mapPins.length > 0 ? (
        <div className="mb-6">
          <OfficesMap pins={mapPins} height="360px" />
        </div>
      ) : null}

      <div className="toolbar">
        <p className="page-subtitle">
          {offices.length} {offices.length === 1 ? "office" : "offices"} total
        </p>
        <Link
          href="/admin/offices/new"
          className="btn btn-primary"
        >
          New office
        </Link>
      </div>

      {offices.length === 0 ? (
        <p className="empty-state">
          No offices yet. Add one to start routing pickups.
        </p>
      ) : (
        <div className="data-table-shell">
          <table className="data-table">
            <thead>
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
                    <td className="px-4 py-2">
                      <span className={o.active ? "badge badge-success" : "badge badge-neutral"}>
                        {o.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="flex gap-2 px-4 py-2">
                      <Link
                        href={`/admin/offices/${o.id}`}
                        className="btn-link"
                      >
                        Edit
                      </Link>
                      {o.active ? (
                        <form
                          action={deactivateOfficeAction.bind(null, o.id)}
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
