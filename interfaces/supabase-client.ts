import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NotConfiguredError } from "@/lib/errors";

/**
 * Singleton Supabase admin client, memoized on `globalThis` so repeated
 * calls (and Next.js HMR reloads in dev) share the same client without
 * rebuilding it.
 *
 * Environment requirements:
 *   - `NEXT_PUBLIC_SUPABASE_URL` — checked FIRST so errors surface this
 *     variable before the service-role key in the missing-env case.
 *   - `SUPABASE_SERVICE_ROLE_KEY` — server-only secret; never referenced
 *     from client code. NEVER embedded in the thrown error message
 *     (`NotConfiguredError` only echoes the variable NAME, never its
 *     value).
 *
 * Shared with the future auth adapter (`interfaces/auth.real.ts`).
 */
const GLOBAL_KEY = Symbol.for("lab-dispatch.supabase-admin");

interface GlobalWithClient {
  [key: symbol]: unknown;
}

export function getSupabaseAdminClient(): SupabaseClient {
  const g = globalThis as GlobalWithClient;
  const cached = g[GLOBAL_KEY];
  if (cached) return cached as SupabaseClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || url.length === 0) {
    throw new NotConfiguredError({
      service: "storage (Supabase)",
      envVar: "NEXT_PUBLIC_SUPABASE_URL",
    });
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.length === 0) {
    throw new NotConfiguredError({
      service: "storage (Supabase)",
      envVar: "SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  g[GLOBAL_KEY] = client;
  return client;
}

/** Test-only: clears the memoized admin client. Not intended for production code. */
export function __resetSupabaseAdminClient(): void {
  const g = globalThis as GlobalWithClient;
  delete g[GLOBAL_KEY];
}
