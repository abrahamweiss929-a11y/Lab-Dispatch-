import type { UserRole } from "./types";

/**
 * Email template builders. Each builder returns a `subject + textBody +
 * htmlBody` triple ready to feed into `services.email.sendEmail`.
 *
 * Templates intentionally keep HTML minimal and inline-style only —
 * no remote CSS, no images — so they render consistently in plain
 * mail clients and survive aggressive HTML sanitizers.
 */

const DEFAULT_APP_URL = "https://labdispatch.app";

/**
 * Public base URL for links inside emails. Reads `NEXT_PUBLIC_APP_URL`
 * if set; otherwise falls back to the production domain. Trailing
 * slashes stripped so callers can safely append paths.
 */
export function appBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env !== undefined && env.length > 0) {
    return env.replace(/\/+$/, "");
  }
  return DEFAULT_APP_URL;
}

export interface EmailTemplate {
  subject: string;
  textBody: string;
  htmlBody: string;
}

function htmlShell(title: string, innerHtml: string): string {
  return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="font-size: 18px; font-weight: 600; margin: 0 0 16px; color: #0b3d91;">Lab Dispatch</h1>
  <h2 style="font-size: 22px; font-weight: 600; margin: 0 0 16px;">${escapeHtml(title)}</h2>
  ${innerHtml}
  <p style="font-size: 12px; color: #6b6b6b; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e5;">Lab Dispatch — automated message. Do not reply unless requested.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ctaButton(url: string, label: string): string {
  return `<p style="margin: 24px 0;"><a href="${escapeHtml(url)}" style="display: inline-block; background: #0b3d91; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">${escapeHtml(label)}</a></p><p style="font-size: 12px; color: #6b6b6b;">Or copy this link: ${escapeHtml(url)}</p>`;
}

function formatExpiry(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ---------- 3a — Invite email ----------------------------------------------

export interface InviteEmailParams {
  role: "driver" | "office";
  token: string;
  expiresAt: string; // ISO
  invitedByName?: string;
}

export function buildInviteEmail(p: InviteEmailParams): EmailTemplate {
  const url = `${appBaseUrl()}/invite/${p.token}`;
  const expiry = formatExpiry(p.expiresAt);
  const roleLabel = p.role === "driver" ? "driver" : "office staff";
  const invitedBy =
    p.invitedByName !== undefined && p.invitedByName.length > 0
      ? p.invitedByName
      : "Your Lab Dispatch admin";

  const articleAndLabel = p.role === "driver" ? "as a driver" : "as office staff";
  const subject = `You've been invited to Lab Dispatch ${articleAndLabel}`;
  const textBody = `${invitedBy} invited you to Lab Dispatch ${articleAndLabel}.

Set up your account here:
${url}

This link expires on ${expiry}. If it expires, ask the admin to send a new invite.

— Lab Dispatch`;

  const htmlBody = htmlShell(
    subject,
    `<p>${escapeHtml(invitedBy)} invited you to Lab Dispatch ${escapeHtml(articleAndLabel)} (${escapeHtml(roleLabel)}).</p>
${ctaButton(url, "Set up your account")}
<p style="font-size: 14px; color: #6b6b6b;">This link expires on <strong>${escapeHtml(expiry)}</strong>. If it expires, ask the admin to send a new invite.</p>`,
  );

  return { subject, textBody, htmlBody };
}

// ---------- 3b — Welcome email ---------------------------------------------

export interface WelcomeEmailParams {
  fullName?: string;
  role: UserRole;
}

export function buildWelcomeEmail(p: WelcomeEmailParams): EmailTemplate {
  // Office shares the dispatcher tree (Phase D widening). Drivers get
  // the driver landing. Admins go to /admin.
  const landingPath =
    p.role === "driver"
      ? "/driver"
      : p.role === "admin"
        ? "/admin"
        : "/dispatcher";
  const landingUrl = `${appBaseUrl()}${landingPath}`;

  const greeting =
    p.fullName !== undefined && p.fullName.length > 0
      ? `Welcome, ${p.fullName}`
      : "Welcome to Lab Dispatch";

  const roleCopy =
    p.role === "driver"
      ? "Your daily route, stops, and pickup history are all on the driver page. Tap a stop when you arrive and again when samples are loaded — that's all the app needs to keep dispatch in sync."
      : p.role === "admin"
        ? "You have full access — drivers, offices, payroll, and invites are all under the admin nav."
        : "You'll find the day's pickup queue, driver routes, and the message inbox under Dispatcher. Editing rights are the same as a dispatcher's.";

  const subject = "Welcome to Lab Dispatch";
  const textBody = `${greeting}.

${roleCopy}

Sign in: ${landingUrl}

— Lab Dispatch`;

  const htmlBody = htmlShell(greeting, `
<p>${escapeHtml(roleCopy)}</p>
${ctaButton(landingUrl, "Open Lab Dispatch")}`);

  return { subject, textBody, htmlBody };
}

// ---------- 3c — Pickup-request confirmation -------------------------------

export interface PickupConfirmationParams {
  officeName: string;
  etaText: string;
  notes?: string;
  sampleCount?: number;
}

export function buildPickupConfirmation(
  p: PickupConfirmationParams,
): EmailTemplate {
  const subject = "Pickup request received — Lab Dispatch";
  const samplesLine =
    p.sampleCount !== undefined && p.sampleCount > 0
      ? `Sample count: ${p.sampleCount}\n`
      : "";
  const notesLine =
    p.notes !== undefined && p.notes.trim().length > 0
      ? `Notes: ${p.notes.trim()}\n`
      : "";

  const textBody = `We received your pickup request for ${p.officeName}.

${samplesLine}${notesLine}Estimated arrival: ${p.etaText}.

— Lab Dispatch`;

  const samplesHtml =
    p.sampleCount !== undefined && p.sampleCount > 0
      ? `<li><strong>Samples:</strong> ${p.sampleCount}</li>`
      : "";
  const notesHtml =
    p.notes !== undefined && p.notes.trim().length > 0
      ? `<li><strong>Notes:</strong> ${escapeHtml(p.notes.trim())}</li>`
      : "";

  const htmlBody = htmlShell(
    "Pickup request received",
    `<p>We received your pickup request for <strong>${escapeHtml(p.officeName)}</strong>.</p>
<ul style="line-height: 1.8;">
  ${samplesHtml}
  ${notesHtml}
  <li><strong>Estimated arrival:</strong> ${escapeHtml(p.etaText)}</li>
</ul>`,
  );

  return { subject, textBody, htmlBody };
}

// ---------- 3d — Driver arrived --------------------------------------------

export interface DriverArrivedParams {
  officeName: string;
  driverName?: string;
  arrivedAt: string; // formatted display string
}

export function buildDriverArrived(p: DriverArrivedParams): EmailTemplate {
  const driver =
    p.driverName !== undefined && p.driverName.length > 0
      ? p.driverName
      : "Your driver";

  const subject = `Driver has arrived at ${p.officeName}`;
  const textBody = `${driver} has arrived at ${p.officeName} (${p.arrivedAt}).

Samples will be picked up shortly.

— Lab Dispatch`;

  const htmlBody = htmlShell(
    `Driver has arrived at ${p.officeName}`,
    `<p><strong>${escapeHtml(driver)}</strong> has arrived at <strong>${escapeHtml(p.officeName)}</strong> at ${escapeHtml(p.arrivedAt)}.</p>
<p>Samples will be picked up shortly.</p>`,
  );

  return { subject, textBody, htmlBody };
}

// ---------- 3e — Samples picked up -----------------------------------------

export interface SamplesPickedUpParams {
  officeName: string;
  driverName?: string;
  pickedUpAt: string;
  sampleCount?: number;
}

export function buildSamplesPickedUp(
  p: SamplesPickedUpParams,
): EmailTemplate {
  const driver =
    p.driverName !== undefined && p.driverName.length > 0
      ? p.driverName
      : "Your driver";

  const samplesText =
    p.sampleCount !== undefined && p.sampleCount > 0
      ? ` (${p.sampleCount} samples)`
      : "";

  const subject = `Samples picked up from ${p.officeName}`;
  const textBody = `${driver} picked up samples${samplesText} from ${p.officeName} at ${p.pickedUpAt}.

Thank you — your samples are now on their way to the lab.

— Lab Dispatch`;

  const htmlBody = htmlShell(
    `Samples picked up from ${p.officeName}`,
    `<p><strong>${escapeHtml(driver)}</strong> picked up samples${samplesText.length > 0 ? ` <strong>${escapeHtml(samplesText.trim())}</strong>` : ""} from <strong>${escapeHtml(p.officeName)}</strong> at ${escapeHtml(p.pickedUpAt)}.</p>
<p>Thank you — your samples are now on their way to the lab.</p>`,
  );

  return { subject, textBody, htmlBody };
}
