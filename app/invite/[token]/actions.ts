"use server";

import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import { acceptInvite } from "@/lib/invites-store";
import { setSession } from "@/lib/session";
import { landingPathFor } from "@/lib/auth-rules";
import { buildWelcomeEmail } from "@/lib/email-templates";
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

  // Best-effort welcome email. Failures are swallowed so a Postmark
  // outage doesn't block the redirect to the role landing page.
  try {
    const tpl = buildWelcomeEmail({ role: result.invite!.role });
    await getServices().email.sendEmail({
      to: result.invite!.email,
      subject: tpl.subject,
      textBody: tpl.textBody,
      htmlBody: tpl.htmlBody,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("acceptInviteAction: welcome email failed", err);
  }

  redirect(landingPathFor(result.invite!.role));
}
