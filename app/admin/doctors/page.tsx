import Link from "next/link";
import { AdminLayout } from "@/components/AdminLayout";
import { getServices } from "@/interfaces";
import { requireAdminSession } from "@/lib/require-admin";
import { DeleteDoctorButton } from "./_components/DeleteDoctorButton";

export default async function DoctorsListPage() {
  requireAdminSession();
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
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {doctors.length} {doctors.length === 1 ? "doctor" : "doctors"} total
        </p>
        <Link
          href="/admin/doctors/new"
          className="rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New doctor
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          No doctors yet. Create an office first, then add doctors to it.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
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
                        className="text-blue-600 hover:underline"
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
