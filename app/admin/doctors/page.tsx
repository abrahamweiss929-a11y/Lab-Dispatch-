import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import { getServices } from "@/interfaces";
import { requireAdminSession } from "@/lib/require-admin";
import { DeleteDoctorButton } from "./_components/DeleteDoctorButton";

export default async function DoctorsListPage() {
  await requireAdminSession();
  const storage = getServices().storage;
  const [doctors, offices] = await Promise.all([
    storage.listDoctors(),
    storage.listOffices(),
  ]);
  const officeById = new Map(offices.map((o) => [o.id, o] as const));

  const rows = [...doctors].sort((a, b) => {
    const officeA = officeById.get(a.officeId)?.name ?? "";
    const officeB = officeById.get(b.officeId)?.name ?? "";
    const byOffice = officeA.localeCompare(officeB);
    return byOffice !== 0 ? byOffice : a.name.localeCompare(b.name);
  });

  return (
    <AdminLayout title="Doctors">
      <div className="toolbar">
        <p className="page-subtitle">
          {doctors.length} {doctors.length === 1 ? "doctor" : "doctors"} total
        </p>
        <Link
          href="/admin/doctors/new"
          className="btn btn-primary"
        >
          New doctor
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="empty-state">
          No doctors yet. Create an office first, then add doctors to it.
        </p>
      ) : (
        <div className="data-table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Office</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((d) => {
                const office = officeById.get(d.officeId);
                return (
                  <tr key={d.id}>
                    <td className="px-4 py-2 font-medium">{d.name}</td>
                    <td className="px-4 py-2">{office?.name ?? "—"}</td>
                    <td className="px-4 py-2">{d.phone ?? "—"}</td>
                    <td className="px-4 py-2">{d.email ?? "—"}</td>
                    <td className="flex gap-2 px-4 py-2">
                      <Link
                        href={`/admin/doctors/${d.id}`}
                        className="btn-link"
                      >
                        Edit
                      </Link>
                      <DeleteDoctorButton
                        doctorId={d.id}
                        doctorName={d.name}
                      />
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
