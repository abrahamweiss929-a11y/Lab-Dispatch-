"use server";

import { revalidatePath } from "next/cache";
import { getServices } from "@/interfaces";
import { buildInviteEmail } from "@/lib/email-templates";
import { isValidInviteEmail } from "@/lib/invites";
import {
  createInvite as createInviteRow,
  revokeInvite as revokeInviteRow,
} from "@/lib/invites-store";
import { requireAdminSession } from "@/lib/require-admin";
import type { Invite } from "@/lib/types";
import type { CreateInviteFormState } from "./form-state";

const ALLOWED_ROLES = new Set<Invite["role"]>(["office", "driver"]);

export async function createInviteAction(
  _prev: CreateInviteFormState,
  formData: FormData,
): Promise<CreateInviteFormState> {
  const session = await requireAdminSession();
  const email = String(formData.get("email") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "office").trim();

  const fieldErrors: Partial<Record<"email" | "role", string>> = {};
  if (!isValidInviteEmail(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }
  const role = roleRaw as Invite["role"];
  if (!ALLOWED_ROLES.has(role)) {
    fieldErrors.role = "Choose office or driver.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", fieldErrors };
  }

  const invite = await createInviteRow({
    email,
    role,
    invitedByProfileId: session.userId,
  });

  // Best-effort email to the invitee with the accept link. Failures
  // are swallowed so the invite is still surfaced in the admin UI as
  // a copy/paste fallback even when Postmark is down or unconfigured.
  try {
    const tpl = buildInviteEmail({
      role: invite.role,
      token: invite.token,
      expiresAt: invite.expiresAt,
    });
    await getServices().email.sendEmail({
      to: invite.email,
      subject: tpl.subject,
      textBody: tpl.textBody,
      htmlBody: tpl.htmlBody,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("createInviteAction: invite email failed", err);
  }

  // Build the accept URL using the request origin if available; the
  // caller (admin user) needs to share this link with the invitee.
  // We construct the path-only URL here; the page renders the absolute
  // URL using `window.location.origin` on the client side.
  const acceptUrl = `/invite/${invite.token}`;

  revalidatePath("/admin/users");
  return { status: "ok", invite, acceptUrl };
}

export async function revokeInviteAction(inviteId: string): Promise<void> {
  await requireAdminSession();
  await revokeInviteRow(inviteId);
  revalidatePath("/admin/users");
}
