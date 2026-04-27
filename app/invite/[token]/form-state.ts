export type AcceptInviteFormState =
  | { status: "idle" }
  | {
      status: "error";
      reason: "not_found" | "expired" | "revoked" | "already_accepted";
    };

export const INITIAL_ACCEPT_INVITE_STATE: AcceptInviteFormState = {
  status: "idle",
};
