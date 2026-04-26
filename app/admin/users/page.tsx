import { AdminLayout } from "@/components/AdminLayout";
import { formatShortDateTime } from "@/lib/dates";
import { listInvites } from "@/lib/invites-store";
import { requireAdminSession } from "@/lib/require-admin";
import { InviteForm } from "./_components/InviteForm";
import { revokeInviteAction } from "./actions";

export default async function AdminUsersPage() {
  await requireAdminSession();
  const invites = listInvites();

  return (
    <AdminLayout title="Users & invites">
      <section className="mb-6">
        <h2 className="page-section-title">Invite a new user</h2>
        <p className="page-subtitle mb-3">
          Office staff get the same access as dispatchers; drivers get the
          driver mobile UI.
        </p>
        <InviteForm />
      </section>

      <section>
        <h2 className="page-section-title">Recent invites</h2>
        {invites.length === 0 ? (
          <p className="empty-state">
            No invites yet. Use the form above to create one.
          </p>
        ) : (
          <div className="data-table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2">Expires</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invites.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-4 py-2 font-medium">{inv.email}</td>
                    <td className="px-4 py-2 capitalize">{inv.role}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          inv.status === "pending"
                            ? "badge badge-info"
                            : inv.status === "accepted"
                              ? "badge badge-success"
                              : "badge badge-neutral"
                        }
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {formatShortDateTime(inv.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {formatShortDateTime(inv.expiresAt)}
                    </td>
                    <td className="px-4 py-2">
                      {inv.status === "pending" ? (
                        <form
                          action={revokeInviteAction.bind(null, inv.id)}
                        >
                          <button
                            type="submit"
                            className="btn-danger text-xs"
                          >
                            Revoke
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminLayout>
  );
}
