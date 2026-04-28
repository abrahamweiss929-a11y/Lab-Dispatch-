import { lookupInviteForAccept } from "@/lib/invites-store";
import { AcceptInviteForm } from "./_components/AcceptInviteForm";

interface InvitePageProps {
  params: { token: string };
}

const REASON_COPY: Record<string, string> = {
  not_found: "This invite link is not valid.",
  expired: "This invite has expired. Ask your admin to send a new one.",
  revoked: "This invite has been revoked.",
  already_accepted: "This invite has already been accepted.",
};

export default async function InvitePage({ params }: InvitePageProps) {
  const result = await lookupInviteForAccept(params.token);

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <div className="brand-lockup mb-6">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <p className="brand-title">Lab Dispatch</p>
          <p className="brand-subtitle">Accept invitation</p>
        </div>
      </div>

      {result.status !== "ok" ? (
        <div className="app-card p-6">
          <p className="alert-error">{REASON_COPY[result.status] ?? "This invite link is not valid."}</p>
        </div>
      ) : (
        <div className="app-card p-6">
          <h1 className="text-xl font-bold">Welcome</h1>
          <p className="mt-2 text-sm text-gray-600">
            You&rsquo;ve been invited to join Lab Dispatch as{" "}
            <strong>{result.invite.role === "office" ? "office staff" : "a driver"}</strong>{" "}
            for <strong>{result.invite.email}</strong>. Click below to
            accept and finish setup.
          </p>
          <div className="mt-4">
            <AcceptInviteForm token={params.token} />
          </div>
        </div>
      )}
    </main>
  );
}
