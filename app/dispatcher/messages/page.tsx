import Link from "next/link";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { formatShortDateTime } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import { ConvertToRequestButton } from "./_components/ConvertToRequestButton";
import { SimulateInboundPanel } from "./_components/SimulateInboundPanel";

type FilterTab = "flagged" | "all";

function parseFilter(raw?: string): FilterTab {
  if (raw === "flagged") return "flagged";
  return "all";
}

function truncate(text: string, max = 140): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export default async function DispatcherMessagesPage({
  searchParams,
}: {
  searchParams?: { filter?: string };
}) {
  requireDispatcherSession();
  const filter = parseFilter(searchParams?.filter);
  const messages = await getServices().storage.listMessages({
    flagged: filter === "flagged" ? true : undefined,
  });

  const showSimulatePanel = process.env.USE_MOCKS !== "false";

  return (
    <DispatcherLayout title="Inbound messages">
      {showSimulatePanel ? <SimulateInboundPanel /> : null}
      <div className="mb-4 flex items-center gap-4">
        <nav className="flex gap-1 rounded bg-gray-100 p-1 text-sm">
          <Link
            href="/dispatcher/messages"
            className={
              filter === "all"
                ? "rounded bg-white px-3 py-1 font-medium shadow-sm"
                : "rounded px-3 py-1 text-gray-600 hover:bg-white"
            }
          >
            All
          </Link>
          <Link
            href="/dispatcher/messages?filter=flagged"
            className={
              filter === "flagged"
                ? "rounded bg-white px-3 py-1 font-medium shadow-sm"
                : "rounded px-3 py-1 text-gray-600 hover:bg-white"
            }
          >
            Flagged only
          </Link>
        </nav>
      </div>

      {messages.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500">
          No messages in this view.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Received</th>
                <th className="px-4 py-2">Channel</th>
                <th className="px-4 py-2">From</th>
                <th className="px-4 py-2">Subject</th>
                <th className="px-4 py-2">Body</th>
                <th className="px-4 py-2">Linked</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2">
                    {formatShortDateTime(m.receivedAt)}
                  </td>
                  <td className="px-4 py-2">{m.channel}</td>
                  <td className="px-4 py-2">{m.fromIdentifier}</td>
                  <td className="px-4 py-2">
                    {m.subject && m.subject.length > 0 ? m.subject : "—"}
                  </td>
                  <td className="px-4 py-2">{truncate(m.body)}</td>
                  <td className="px-4 py-2">
                    {m.pickupRequestId
                      ? `Yes, #${m.pickupRequestId.slice(0, 6)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {m.pickupRequestId ? null : (
                      <ConvertToRequestButton messageId={m.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DispatcherLayout>
  );
}
