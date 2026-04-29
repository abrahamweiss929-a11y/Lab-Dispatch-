import Link from "next/link";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { LocalDateTime } from "@/components/LocalDateTime";
import { getServices } from "@/interfaces";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import { resolveSenderDisplay } from "@/lib/sender-display";
import { SenderCell } from "../_components/SenderCell";
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
  const storage = getServices().storage;
  const [messages, offices, doctors] = await Promise.all([
    storage.listMessages({
      flagged: filter === "flagged" ? true : undefined,
    }),
    storage.listOffices(),
    storage.listDoctors(),
  ]);

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
                    <LocalDateTime iso={m.receivedAt} style="relative" />
                  </td>
                  <td className="px-4 py-2">
                    <span className="badge badge-info">{m.channel}</span>
                  </td>
                  <td className="px-4 py-2">
                    <SenderCell
                      display={resolveSenderDisplay(
                        m.fromIdentifier,
                        offices,
                        doctors,
                      )}
                    />
                  </td>
                  <td className="px-4 py-2">
                    {m.subject && m.subject.length > 0 ? m.subject : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/dispatcher/messages/${m.id}`}
                      className="link"
                    >
                      {truncate(m.body)}
                    </Link>
                  </td>
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
                    <Link
                      href={`/dispatcher/messages/${m.id}`}
                      className="link"
                    >
                      Open
                    </Link>
                    {" · "}
                    {/*
                      Always show "Convert to request". When the
                      message is already linked (auto-created via
                      the inbound pipeline), clicking creates a
                      standalone manual request from the same body —
                      useful when the auto-detected fields were wrong
                      and the dispatcher wants to start fresh.
                    */}
                    <ConvertToRequestButton messageId={m.id} />
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
