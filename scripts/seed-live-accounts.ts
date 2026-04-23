/**
 * Seed three test accounts (admin/dispatcher/driver) into the real
 * Supabase Auth + `profiles` table.
 *
 * This is an operator tool, NOT application code. Run via:
 *   npm run seed-live-accounts
 * which shells out to `tsx --env-file=.env.local scripts/seed-live-accounts.ts`
 * so both the service-role key and the anon key are loaded.
 *
 * Idempotent: searches `auth.admin.listUsers()` for an existing user
 * before creating. Upserts the `profiles` row on every run so the role
 * and display name stay consistent with the source of truth in this
 * file.
 *
 * Security invariants:
 *   - NEVER logs the service-role key, the anon key, or the shared
 *     temporary password (`test1234`). The only operator-visible lines
 *     are per-account status lines and the trailing summary. Error
 *     messages surface only the Supabase `message` field — never the
 *     original error object (which may echo the Authorization header
 *     back).
 *   - Does NOT rely on RLS — uses the service-role admin client so it
 *     works regardless of policy state.
 */

import { getSupabaseAdminClient } from "@/interfaces/supabase-client";
import type { UserRole } from "@/lib/types";

interface SeedAccount {
  email: string;
  role: UserRole;
  fullName: string;
}

const TEMPORARY_PASSWORD = "test1234";

const ACCOUNTS: readonly SeedAccount[] = [
  { email: "admin@test", role: "admin", fullName: "Test Admin" },
  { email: "dispatcher@test", role: "dispatcher", fullName: "Test Dispatcher" },
  { email: "driver@test", role: "driver", fullName: "Test Driver" },
];

function scrub(text: string): string {
  // Belt-and-suspenders: never echo the shared password verbatim.
  return text.split(TEMPORARY_PASSWORD).join("[redacted]");
}

async function findUserIdByEmail(
  sb: ReturnType<typeof getSupabaseAdminClient>,
  email: string,
): Promise<string | null> {
  // Supabase does not expose `getUserByEmail` — list and search.
  const { data, error } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) {
    throw new Error(`listUsers failed: ${scrub(error.message ?? "(no message)")}`);
  }
  const match = data.users.find(
    (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
  );
  return match?.id ?? null;
}

async function seedAccount(
  sb: ReturnType<typeof getSupabaseAdminClient>,
  account: SeedAccount,
): Promise<{ created: boolean; userId: string }> {
  const existingId = await findUserIdByEmail(sb, account.email);
  let userId: string;
  let created = false;
  if (existingId !== null) {
    userId = existingId;
  } else {
    const createResp = await sb.auth.admin.createUser({
      email: account.email,
      password: TEMPORARY_PASSWORD,
      email_confirm: true,
    });
    if (createResp.error || !createResp.data.user) {
      throw new Error(
        `createUser failed for ${account.email}: ${scrub(
          createResp.error?.message ?? "(no message)",
        )}`,
      );
    }
    userId = createResp.data.user.id;
    created = true;
  }

  // Upsert the profile row so role + full_name match the source of truth
  // in this file on every run.
  const upsertResp = await sb
    .from("profiles")
    .upsert(
      {
        id: userId,
        role: account.role,
        full_name: account.fullName,
        phone: null,
      },
      { onConflict: "id" },
    );
  if (upsertResp.error) {
    throw new Error(
      `upsert profiles failed for ${account.email}: ${scrub(
        upsertResp.error.message ?? "(no message)",
      )}`,
    );
  }
  return { created, userId };
}

async function main(): Promise<void> {
  const sb = getSupabaseAdminClient();
  for (const account of ACCOUNTS) {
    const { created, userId } = await seedAccount(sb, account);
    const prefix = created ? "OK" : "SKIPPED";
    const detail = created
      ? `role=${account.role}, user_id=${userId}`
      : "already exists";
    process.stdout.write(`${prefix} ${account.email} (${detail})\n`);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`FAIL seed-live-accounts: ${scrub(msg)}\n`);
  process.exit(1);
});
