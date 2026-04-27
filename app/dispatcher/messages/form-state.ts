// Form-state types and initial values for /dispatcher/messages.
// Lives in its own file so the actions.ts module can keep `"use server"`
// at the top — Next.js requires "use server" files to export only
// async functions.

export type SimulateInboundFormState =
  | { status: "idle"; message: null }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export const INITIAL_SIMULATE_INBOUND_STATE: SimulateInboundFormState = {
  status: "idle",
  message: null,
};
