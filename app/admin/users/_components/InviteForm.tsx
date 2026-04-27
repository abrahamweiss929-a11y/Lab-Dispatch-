"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createInviteAction } from "../actions";
import { INITIAL_CREATE_INVITE_STATE } from "../form-state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-primary disabled:opacity-60"
    >
      {pending ? "Creating…" : "Create invite"}
    </button>
  );
}

export function InviteForm() {
  const [state, action] = useFormState(
    createInviteAction,
    INITIAL_CREATE_INVITE_STATE,
  );

  const fieldErrors =
    state.status === "error" ? state.fieldErrors : ({} as Partial<Record<"email" | "role", string>>);

  return (
    <form action={action} className="form-grid">
      <div className="form-row">
        <label htmlFor="invite-email" className="form-label">
          Email
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          className="form-input"
          placeholder="user@example.com"
        />
        {fieldErrors.email ? (
          <p className="form-error">{fieldErrors.email}</p>
        ) : null}
      </div>
      <div className="form-row">
        <label htmlFor="invite-role" className="form-label">
          Role
        </label>
        <select
          id="invite-role"
          name="role"
          defaultValue="office"
          className="form-input"
        >
          <option value="office">Office staff</option>
          <option value="driver">Driver</option>
        </select>
        {fieldErrors.role ? (
          <p className="form-error">{fieldErrors.role}</p>
        ) : null}
      </div>
      <SubmitButton />

      {state.status === "ok" ? (
        <p className="alert-success mt-2">
          Invite created. Share this link with{" "}
          <strong>{state.invite.email}</strong>:{" "}
          <code className="break-all">{state.acceptUrl}</code>
        </p>
      ) : null}
    </form>
  );
}
