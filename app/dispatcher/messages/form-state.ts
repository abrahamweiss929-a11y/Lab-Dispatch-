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

export type ReplyChannel = "email" | "sms";

export type ReplyMessageFormState =
  | { status: "idle"; error: null }
  | { status: "ok"; sentTo: string; channel: ReplyChannel; error: null }
  | {
      status: "error";
      error: string;
      fieldErrors: Partial<Record<"to" | "subject" | "body", string>>;
    };

export const INITIAL_REPLY_MESSAGE_STATE: ReplyMessageFormState = {
  status: "idle",
  error: null,
};
