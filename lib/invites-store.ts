import "server-only";
import { getSupabaseAdminClient } from "@/interfaces/supabase-client";
import { makeRandomId } from "@/lib/ids";
import {
  defaultInviteExpiryIso,
  evaluateInvite,
  generateInviteToken,
  type InviteOutcome,
} from "@/lib/invites";
import type { Invite } from "@/lib/types";

/**
 * Dual-mode invite store.
 *
 *   - When `USE_MOCKS !== "false"` (mock mode, default in dev/test):
 *     keeps invites in an in-memory `Map<id, Invite>` on the current
 *     process. Restart resets. No HMR persistence (auth-sensitive).
 *
 *   - When `USE_MOCKS === "false"` (production/staging): every call
 *     hits the Supabase `invites` table via the service-role admin
 *     client. The table schema is defined in
 *     `supabase/migrations/2026-04-26-phase-d-invites.sql` and shaped
 *     1:1 to the `Invite` interface in `lib/types.ts`.
 *
 * Bug fix: prior to 2026-04-27 this module was in-memory only, which
 * meant invites created on serverless instance A vanished from
 * instance B — every fresh invite link returned "This invite link is
 * not valid" in production. Adding the Supabase path here is the
 * minimal change that fixes the cross-instance lookup without
 * changing the public API shape (apart from making everything async).
 */

interface InviteStoreState {
  byId: Map<string, Invite>;
}

const memState: InviteStoreState = {
  byId: new Map(),
};

function isRealMode(): boolean {
  return process.env.USE_MOCKS === "false";
}

interface DbInviteRow {
  id: string;
  email: string;
  role: "office" | "driver";
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  invited_by_profile_id: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_profile_id: string | null;
}

function rowToInvite(row: DbInviteRow): Invite {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    token: row.token,
    status: row.status,
    invitedByProfileId: row.invited_by_profile_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at ?? undefined,
    acceptedByProfileId: row.accepted_by_profile_id ?? undefined,
  };
}

export interface CreateInviteParams {
  email: string;
  role: "office" | "driver";
  invitedByProfileId: string;
}

export async function createInvite(
  params: CreateInviteParams,
): Promise<Invite> {
  const email = params.email.trim().toLowerCase();
  const token = generateInviteToken();
  const expiresAt = defaultInviteExpiryIso();

  if (isRealMode()) {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb
      .from("invites")
      .insert({
        email,
        role: params.role,
        token,
        status: "pending",
        invited_by_profile_id: params.invitedByProfileId,
        expires_at: expiresAt,
      })
      .select("*")
      .single();
    if (error) throw new Error(`createInvite: ${error.message ?? "unknown"}`);
    if (!data) throw new Error("createInvite: no row returned");
    return rowToInvite(data as DbInviteRow);
  }

  const id = makeRandomId();
  const now = new Date().toISOString();
  const invite: Invite = {
    id,
    email,
    role: params.role,
    token,
    status: "pending",
    invitedByProfileId: params.invitedByProfileId,
    createdAt: now,
    expiresAt,
  };
  memState.byId.set(id, invite);
  return invite;
}

export async function getInviteByToken(
  token: string,
): Promise<Invite | null> {
  if (isRealMode()) {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb
      .from("invites")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    if (error) {
      throw new Error(`getInviteByToken: ${error.message ?? "unknown"}`);
    }
    return data ? rowToInvite(data as DbInviteRow) : null;
  }
  for (const invite of memState.byId.values()) {
    if (invite.token === token) return invite;
  }
  return null;
}

export async function listInvites(): Promise<Invite[]> {
  if (isRealMode()) {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb
      .from("invites")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`listInvites: ${error.message ?? "unknown"}`);
    return (data ?? []).map((r) => rowToInvite(r as DbInviteRow));
  }
  // Newest first.
  return Array.from(memState.byId.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export async function lookupInviteForAccept(
  token: string,
): Promise<InviteOutcome> {
  return evaluateInvite(await getInviteByToken(token));
}

export interface AcceptInviteResult {
  outcome: InviteOutcome;
  /** The accepted invite row (only set when outcome.status === "ok"). */
  invite?: Invite;
}

export async function acceptInvite(
  token: string,
  acceptedByProfileId: string,
): Promise<AcceptInviteResult> {
  const outcome = await lookupInviteForAccept(token);
  if (outcome.status !== "ok") {
    return { outcome };
  }

  const acceptedAt = new Date().toISOString();

  if (isRealMode()) {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb
      .from("invites")
      .update({
        status: "accepted",
        accepted_at: acceptedAt,
        accepted_by_profile_id: acceptedByProfileId,
      })
      .eq("id", outcome.invite.id)
      // Guard against races: only flip if it's still pending.
      .eq("status", "pending")
      .select("*")
      .single();
    if (error) throw new Error(`acceptInvite: ${error.message ?? "unknown"}`);
    if (!data) {
      // Race lost — re-evaluate to get the correct outcome.
      const reread = await lookupInviteForAccept(token);
      return { outcome: reread };
    }
    const updated = rowToInvite(data as DbInviteRow);
    return { outcome: { status: "ok", invite: updated }, invite: updated };
  }

  const updated: Invite = {
    ...outcome.invite,
    status: "accepted",
    acceptedAt,
    acceptedByProfileId,
  };
  memState.byId.set(updated.id, updated);
  return { outcome: { status: "ok", invite: updated }, invite: updated };
}

export async function revokeInvite(id: string): Promise<boolean> {
  if (isRealMode()) {
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb
      .from("invites")
      .update({ status: "revoked" })
      .eq("id", id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`revokeInvite: ${error.message ?? "unknown"}`);
    return data !== null;
  }
  const existing = memState.byId.get(id);
  if (existing === undefined || existing.status !== "pending") return false;
  memState.byId.set(id, { ...existing, status: "revoked" });
  return true;
}

export function resetInviteStore(): void {
  memState.byId.clear();
}
