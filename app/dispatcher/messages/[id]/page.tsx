import Link from "next/link";
import { notFound } from "next/navigation";
import { DispatcherLayout } from "@/components/DispatcherLayout";
import { getServices } from "@/interfaces";
import { formatShortDateTime } from "@/lib/dates";
import { requireDispatcherSession } from "@/lib/require-dispatcher";
import { ReplyForm } from "../_components/ReplyForm";

interface PageProps {
  params: { id: string };
}

export default async function DispatcherMessageDetailPage({
  params,
}: PageProps) {
  await requireDispatcherSession();
  const storage = getServices().storage;

  // For v1, fetch the full list and find by id. The messages table is
  // small (recent inbox); a per-row getter can be added later if needed.
  const messages = await storage.listMessages({});
  const message = messages.find((m) => m.id === params.id);
  if (message === undefined) {
    notFound();
  }

  // For email replies, see if we can match the sender to a known
  // office — that gates the "Reply via Email" affordance, since email
  // replies should only go to verified office addresses.
  let matchedOffice: { id: string; name: string; email?: string } | null = null;
  if (message.channel === "email") {
    const office = await storage.findOfficeByEmail(message.fromIdentifier);
    if (office !== null) {
      matchedOffice = { id: office.id, name: office.name, email: office.email };
    }
  }

  const canReplyByEmail =
    message.channel === "email" &&
    matchedOffice !== null &&
    matchedOffice.email !== undefined &&
    matchedOffice.email.length > 0;
  const canReplyBySms = message.channel === "sms";

  const replySubject =
    message.subject !== undefined && message.subject.length > 0
      ? message.subject.toLowerCase().startsWith("re:")
        ? message.subject
        : `Re: ${message.subject}`
      : "Re: Pickup request";

  return (
    <DispatcherLayout title="Message detail">
      <p>
        <Link href="/dispatcher/messages" className="link-muted">
          ← Back to messages
        </Link>
      </p>

      <section className="card">
        <header className="card-header">
          <span className="badge badge-info">{message.channel}</span>
          <span className="text-sm text-gray-500">
            {formatShortDateTime(message.receivedAt)}
          </span>
        </header>
        <dl className="kv-grid">
          <dt>From</dt>
          <dd>{message.fromIdentifier}</dd>
          {message.subject !== undefined && message.subject.length > 0 ? (
            <>
              <dt>Subject</dt>
              <dd>{message.subject}</dd>
            </>
          ) : null}
          {matchedOffice !== null ? (
            <>
              <dt>Matched office</dt>
              <dd>{matchedOffice.name}</dd>
            </>
          ) : null}
          {message.pickupRequestId !== undefined ? (
            <>
              <dt>Linked pickup</dt>
              <dd>
                <Link
                  href={`/dispatcher/requests/${message.pickupRequestId}`}
                  className="link"
                >
                  #{message.pickupRequestId.slice(0, 6)}
                </Link>
              </dd>
            </>
          ) : null}
        </dl>
        <div className="message-body">
          <pre className="message-pre">{message.body}</pre>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Reply</h2>
        {canReplyByEmail ? (
          <ReplyForm
            messageId={message.id}
            channel="email"
            defaultTo={message.fromIdentifier}
            defaultSubject={replySubject}
          />
        ) : null}
        {canReplyBySms ? (
          <ReplyForm
            messageId={message.id}
            channel="sms"
            defaultTo={message.fromIdentifier}
          />
        ) : null}
        {!canReplyByEmail && !canReplyBySms ? (
          <p className="empty-state">
            Reply isn&apos;t available for this message — email replies require
            a sender that matches a known office.
          </p>
        ) : null}
      </section>
    </DispatcherLayout>
  );
}
