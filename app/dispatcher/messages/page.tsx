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
  await requireDispatcherSession();
  const filter = parseFilter(searchParams?.filter);
  const messages = await getServices().storage.listMessages({
    flagged: filter === "flagged" ? true : undefined,
  });

  const showSimulatePanel = process.env.USE_MOCKS !== "false";

  return (
    <DispatcherLayout title="Inbound messages">
      {showSimulatePanel ? <SimulateInboundPanel /> : null}
      <div className="toolbar">
        <nav className="segmented-nav">
          <Link
            href="/dispatcher/messages"
            className={
              filter === "all"
                ? "segmented-link segmented-link-active"
                : "segmented-link"
            }
          >
            All
          </Link>
          <Link
            href="/dispatcher/messages?filter=flagged"
            className={
              filter === "flagged"
                ? "segmented-link segmented-link-active"
                : "segmented-link"
            }
          >
            Flagged only
          </Link>
        </nav>
      </div>

      {messages.length === 0 ? (
        <p className="empty-state">
          No messages in this view.
        </p>
      ) : (
        <div className="data-table-shell">
          <table className="data-table">
            <thead>
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
                  <td className="px-4 py-2">
                    <span className="badge badge-info">{m.channel}</span>
                  </td>
                  <td className="px-4 py-2">{m.fromIdentifier}</td>
                  <td className="px-4 py-2">
                    {m.subject && m.subject.length > 0 ? m.subject : "—"}
                  </td>
                  <td className="px-4 py-2">{truncate(m.body)}</td>
                  <td className="px-4 py-2">
                    {m.pickupRequestId
                      ? (
                        <span className="badge badge-success">
                          Linked #{m.pickupRequestId.slice(0, 6)}
                        </span>
                      ) : (
                        "—"
                      )}
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
