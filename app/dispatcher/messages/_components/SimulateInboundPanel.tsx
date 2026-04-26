"use client";

import { useFormState } from "react-dom";
import {
  INITIAL_SIMULATE_INBOUND_STATE,
  simulateInboundAction,
  type SimulateInboundFormState,
} from "../actions";

function Banner({
  state,
}: {
  state: SimulateInboundFormState | undefined;
}) {
  if (!state || state.status === "idle") return null;
  const tone =
    state.status === "ok"
      ? "alert-success"
      : "alert-error";
  return (
    <p role="status" className={`mt-3 text-xs ${tone}`}>
      {state.message}
    </p>
  );
}

export function SimulateInboundPanel() {
  const [smsState, smsAction] = useFormState(
    simulateInboundAction,
    INITIAL_SIMULATE_INBOUND_STATE,
  );
  const [emailState, emailAction] = useFormState(
    simulateInboundAction,
    INITIAL_SIMULATE_INBOUND_STATE,
  );

  return (
    <section className="app-card mb-4 border-dashed border-amber-300 bg-amber-50/70 p-4">
      <h2 className="text-sm font-extrabold text-amber-950">
        Simulate inbound (mock mode only)
      </h2>
      <p className="mt-1 text-xs leading-5 text-amber-900/80">
        Posts a synthetic message through the same pipeline the real webhooks
        use. Auto-replies land in the mock SMS/email store.
      </p>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <form action={smsAction} className="mini-form rounded-lg border border-white bg-white/85 p-3 shadow-sm">
          <h3 className="text-xs font-extrabold uppercase text-[var(--brand-800)]">
            Test SMS
          </h3>
          <input type="hidden" name="channel" value="sms" />
          <label className="mt-2 block text-xs text-gray-700">
            From
            <input
              name="from"
              type="text"
              required
              placeholder="+15551234567"
              className="mt-1 text-sm"
            />
          </label>
          <label className="mt-2 block text-xs text-gray-700">
            Body
            <textarea
              name="body"
              required
              rows={3}
              className="mt-1 text-sm"
              placeholder="pickup 2 samples please"
            />
          </label>
          <button
            type="submit"
            className="mt-2 text-xs"
          >
            Send test SMS
          </button>
          <Banner state={smsState} />
        </form>

        <form action={emailAction} className="mini-form rounded-lg border border-white bg-white/85 p-3 shadow-sm">
          <h3 className="text-xs font-extrabold uppercase text-[var(--brand-800)]">
            Test Email
          </h3>
          <input type="hidden" name="channel" value="email" />
          <label className="mt-2 block text-xs text-gray-700">
            From
            <input
              name="from"
              type="text"
              required
              placeholder="front-desk@office.test"
              className="mt-1 text-sm"
            />
          </label>
          <label className="mt-2 block text-xs text-gray-700">
            Subject
            <input
              name="subject"
              type="text"
              className="mt-1 text-sm"
              placeholder="Pickup today"
            />
          </label>
          <label className="mt-2 block text-xs text-gray-700">
            Body
            <textarea
              name="body"
              required
              rows={3}
              className="mt-1 text-sm"
              placeholder="Please come pick up 2 samples this afternoon."
            />
          </label>
          <button
            type="submit"
            className="mt-2 text-xs"
          >
            Send test email
          </button>
          <Banner state={emailState} />
        </form>
      </div>
    </section>
  );
}
