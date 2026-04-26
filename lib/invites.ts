import { randomBytes } from "node:crypto";
import type { Invite } from "@/lib/types";

/**
 * Pure helpers for the invite flow. The actual storage seam lives in
 * `interfaces/storage.ts` (`createInvite`, `getInviteByToken`, …) so this
 * module stays I/O-free and unit-testable.
 */

export const INVITE_EXPIRY_DAYS = 7;

/**
 * 32 bytes of crypto randomness, base64url-encoded (no padding) — yields
 * a 43-character token. URL-safe; suitable to drop into a path segment.
 */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function defaultInviteExpiryIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + INVITE_EXPIRY_DAYS);
  return d.toISOString();
}

export type InviteOutcome =
  | { status: "ok"; invite: Invite }
  | { status: "not_found" }
  | { status: "already_accepted" }
  | { status: "revoked" }
  | { status: "expired" };

/**
 * Computes the disposition of an invite at the moment it is being
 * looked up. Pure — does not mutate the row. The caller flips the row
 * to `accepted` (or `expired`) afterward.
 */
export function evaluateInvite(
  invite: Invite | null,
  now: Date = new Date(),
): InviteOutcome {
  if (invite === null) return { status: "not_found" };
  if (invite.status === "revoked") return { status: "revoked" };
  if (invite.status === "accepted") return { status: "already_accepted" };
  const expiresAt = new Date(invite.expiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt < now.getTime()) {
    return { status: "expired" };
  }
  return { status: "ok", invite };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidInviteEmail(email: string): boolean {
  if (typeof email !== "string") return false;
  if (email.length === 0 || email.length > 320) return false;
  return EMAIL_RE.test(email);
}
