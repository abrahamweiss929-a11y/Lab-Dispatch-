import type { Invite } from "@/lib/types";

export type CreateInviteFormState =
  | { status: "idle" }
  | {
      status: "ok";
      invite: Invite;
      acceptUrl: string;
    }
  | {
      status: "error";
      error?: string;
      fieldErrors: Partial<Record<"email" | "role", string>>;
    };

export const INITIAL_CREATE_INVITE_STATE: CreateInviteFormState = {
  status: "idle",
};
