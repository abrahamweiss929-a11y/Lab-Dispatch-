"use client";

import { useFormState, useFormStatus } from "react-dom";
import { acceptInviteAction } from "../actions";
import {
  INITIAL_ACCEPT_INVITE_STATE,
  type AcceptInviteFormState,
} from "../form-state";

const REASON_COPY: Record<
  Exclude<AcceptInviteFormState, { status: "idle" }>["reason"],
  string
> = {
  not_found: "This invite link is not valid.",
  expired: "This invite has expired. Ask your admin to send a new one.",
  revoked: "This invite has been revoked.",
  already_accepted: "This invite has already been accepted.",
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-primary w-full"
    >
      {pending ? "Accepting…" : "Accept invite"}
    </button>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const bound = acceptInviteAction.bind(null, token);
  const [state, action] = useFormState(bound, INITIAL_ACCEPT_INVITE_STATE);

  return (
    <form action={action} className="form-grid">
      <SubmitButton />
      {state.status === "error" ? (
        <p className="alert-error mt-2">{REASON_COPY[state.reason]}</p>
      ) : null}
    </form>
  );
}
