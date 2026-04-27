"use server";

import { redirect } from "next/navigation";
import { acceptInvite } from "@/lib/invites-store";
import { setSession } from "@/lib/session";
import { landingPathFor } from "@/lib/auth-rules";
import { makeRandomId } from "@/lib/ids";
import type { AcceptInviteFormState } from "./form-state";

/**
 * Accepts an invite using the URL token. In mock mode this also signs
 * the user in by minting a fresh `userId` and writing the session
 * cookie — it's the simplest end-to-end demo of the flow without
 * requiring a Supabase signup. In real (USE_MOCKS=false) mode this
 * action would hand off to `supabase.auth.admin.createUser` first and
 * THEN write the session; that swap is documented in PHASE_D_REPORT.md.
 */
export async function acceptInviteAction(
  token: string,
  _prev: AcceptInviteFormState,
): Promise<AcceptInviteFormState> {
  const acceptedByProfileId = makeRandomId();
  const result = acceptInvite(token, acceptedByProfileId);
  if (result.outcome.status !== "ok") {
    if (result.outcome.status === "not_found") {
      return { status: "error", reason: "not_found" };
    }
    return { status: "error", reason: result.outcome.status };
  }
  await setSession(acceptedByProfileId, result.invite!.role);
  redirect(landingPathFor(result.invite!.role));
}
