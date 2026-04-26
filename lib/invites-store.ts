import "server-only";
import { makeRandomId } from "@/lib/ids";
import {
  defaultInviteExpiryIso,
  evaluateInvite,
  generateInviteToken,
  type InviteOutcome,
} from "@/lib/invites";
import type { Invite } from "@/lib/types";

/**
 * In-memory invite store. Mirrors the shape of the production
 * `invites` table defined in `supabase/schema.sql` (added in Phase D).
 *
 * In real Supabase mode this module is replaced by storage methods on
 * `interfaces/storage.ts` (`createInvite`, `getInviteByToken`,
 * `acceptInvite`, `listInvites`). This branch wires the mock path only;
 * the production swap is mechanical (`createInvite` insert, fetch by
 * token, update status). The migration file in `supabase/schema.sql`
 * (this branch) carries the SQL.
 *
 * We avoid `globalThis` HMR persistence here on purpose — invites are
 * sensitive auth artifacts and an HMR-stale invite from a prior run
 * could leak across reloads. Restart resets the table.
 */

interface InviteStoreState {
  byId: Map<string, Invite>;
}

const state: InviteStoreState = {
  byId: new Map(),
};

export interface CreateInviteParams {
  email: string;
  role: "office" | "driver";
  invitedByProfileId: string;
}

export function createInvite(params: CreateInviteParams): Invite {
  const id = makeRandomId();
  const now = new Date().toISOString();
  const invite: Invite = {
    id,
    email: params.email.trim().toLowerCase(),
    role: params.role,
    token: generateInviteToken(),
    status: "pending",
    invitedByProfileId: params.invitedByProfileId,
    createdAt: now,
    expiresAt: defaultInviteExpiryIso(),
  };
  state.byId.set(id, invite);
  return invite;
}

export function getInviteByToken(token: string): Invite | null {
  for (const invite of state.byId.values()) {
    if (invite.token === token) return invite;
  }
  return null;
}

export function listInvites(): Invite[] {
  // Newest first.
  return Array.from(state.byId.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function lookupInviteForAccept(token: string): InviteOutcome {
  return evaluateInvite(getInviteByToken(token));
}

export interface AcceptInviteResult {
  outcome: InviteOutcome;
  /** The accepted invite row (only set when outcome.status === "ok"). */
  invite?: Invite;
}

export function acceptInvite(
  token: string,
  acceptedByProfileId: string,
): AcceptInviteResult {
  const outcome = lookupInviteForAccept(token);
  if (outcome.status !== "ok") {
    return { outcome };
  }
  const updated: Invite = {
    ...outcome.invite,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
    acceptedByProfileId,
  };
  state.byId.set(updated.id, updated);
  return { outcome: { status: "ok", invite: updated }, invite: updated };
}

export function revokeInvite(id: string): boolean {
  const existing = state.byId.get(id);
  if (existing === undefined || existing.status !== "pending") return false;
  state.byId.set(id, { ...existing, status: "revoked" });
  return true;
}

export function resetInviteStore(): void {
  state.byId.clear();
}
