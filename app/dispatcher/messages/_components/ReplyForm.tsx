"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  INITIAL_REPLY_MESSAGE_STATE,
  sendReplyAction,
  type ReplyChannel,
} from "../actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "Sending…" : label}
    </button>
  );
}

interface ReplyFormProps {
  messageId: string;
  channel: ReplyChannel;
  defaultTo: string;
  defaultSubject?: string;
}

export function ReplyForm({
  messageId,
  channel,
  defaultTo,
  defaultSubject,
}: ReplyFormProps) {
  const [state, formAction] = useFormState(
    sendReplyAction,
    INITIAL_REPLY_MESSAGE_STATE,
  );

  const isEmail = channel === "email";

  return (
    <form action={formAction} noValidate className="form-card">
      <input type="hidden" name="channel" value={channel} />
      <input type="hidden" name="messageId" value={messageId} />

      <div className="form-row">
        <label className="form-label" htmlFor="reply-to">
          To
        </label>
        <input
          id="reply-to"
          name="to"
          type="text"
          defaultValue={defaultTo}
          className="form-input"
        />
        {state.status === "error" && state.fieldErrors.to ? (
          <p className="form-error">{state.fieldErrors.to}</p>
        ) : null}
      </div>

      {isEmail ? (
        <div className="form-row">
          <label className="form-label" htmlFor="reply-subject">
            Subject
          </label>
          <input
            id="reply-subject"
            name="subject"
            type="text"
            defaultValue={defaultSubject ?? ""}
            className="form-input"
          />
          {state.status === "error" && state.fieldErrors.subject ? (
            <p className="form-error">{state.fieldErrors.subject}</p>
          ) : null}
        </div>
      ) : (
        <input type="hidden" name="subject" value="" />
      )}

      <div className="form-row">
        <label className="form-label" htmlFor="reply-body">
          Message
        </label>
        <textarea
          id="reply-body"
          name="body"
          rows={6}
          className="form-input"
        />
        {state.status === "error" && state.fieldErrors.body ? (
          <p className="form-error">{state.fieldErrors.body}</p>
        ) : null}
      </div>

      {state.status === "error" && state.error ? (
        <p className="form-error">{state.error}</p>
      ) : null}

      {state.status === "ok" ? (
        <p className="form-success">
          Reply sent via {state.channel} to {state.sentTo}.
        </p>
      ) : null}

      <div className="form-actions">
        <SubmitButton label={isEmail ? "Send email" : "Send SMS"} />
      </div>
    </form>
  );
}
