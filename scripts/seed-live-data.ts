/**
 * Seed minimal demo data into the real Supabase project.
 *
 * Idempotent: gates on the existence of a sentinel office
 * (slug = "lab-dispatch-demo-v1"). Re-running is safe.
 *
 * Run via:
 *   npm run seed-live-data
 *
 * Prerequisites: seed-live-accounts must have run first so that
 * the driver@test profiles + drivers rows exist.
 *
 * Security: uses the service-role admin client — bypasses RLS.
 * Never logs keys or secrets.
 */

import { getSupabaseAdminClient } from "@/interfaces/supabase-client";
import { makeRandomId } from "@/lib/ids";

const SENTINEL_SLUG = "lab-dispatch-demo-v1";

function scrub(text: string): string {
  // Belt-and-suspenders: strip JWT-shaped strings from error messages.
  return text.replace(/eyJ[a-zA-Z0-9_.-]+/g, "[redacted]");
}

export async function hasSentinelOffice(
  sb: ReturnType<typeof getSupabaseAdminClient>,
): Promise<boolean> {
  const { data, error } = await sb
    .from("offices")
    .select("id")
    .eq("slug", SENTINEL_SLUG)
    .maybeSingle();
  if (error) {
    throw new Error(`hasSentinelOffice failed: ${scrub(error.message ?? "(no message)")}`);
  }
  return data !== null;
}

export async function seedDemoData(
  sb: ReturnType<typeof getSupabaseAdminClient>,
): Promise<{ officeId: string; doctorId: string }> {
  const pickupUrlToken = makeRandomId(12);

  const officeResp = await sb
    .from("offices")
    .insert({
      name: "Demo Medical Group",
      slug: SENTINEL_SLUG,
      pickup_url_token: pickupUrlToken,
      phone: "+13125550100",
      email: "demo@demo.lab",
      address_street: "123 Demo St",
      address_city: "Chicago",
      address_state: "IL",
      address_zip: "60601",
      active: true,
    })
    .select("id")
    .single();

  if (officeResp.error || !officeResp.data) {
    throw new Error(
      `insert offices failed: ${scrub(officeResp.error?.message ?? "(no message)")}`,
    );
  }
  const officeId = officeResp.data.id as string;

  const doctorResp = await sb
    .from("doctors")
    .insert({
      office_id: officeId,
      name: "Dr. Demo",
      phone: "+13125550101",
      email: "dr.demo@demo.lab",
    })
    .select("id")
    .single();

  if (doctorResp.error || !doctorResp.data) {
    throw new Error(
      `insert doctors failed: ${scrub(doctorResp.error?.message ?? "(no message)")}`,
    );
  }
  const doctorId = doctorResp.data.id as string;

  return { officeId, doctorId };
}

async function main(): Promise<void> {
  const sb = getSupabaseAdminClient();

  if (await hasSentinelOffice(sb)) {
    process.stdout.write(`SKIPPED — sentinel office "${SENTINEL_SLUG}" already exists\n`);
    return;
  }

  const { officeId, doctorId } = await seedDemoData(sb);
  process.stdout.write(`OK office_id=${officeId} doctor_id=${doctorId}\n`);
  process.stdout.write(
    `  Visit /pickup/${SENTINEL_SLUG}-<token> to test the pickup form\n`,
  );
  process.stdout.write(
    `  Run seed-live-accounts first if driver@test is missing its drivers row\n`,
  );
}

import { fileURLToPath } from "node:url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`FAIL seed-live-data: ${scrub(msg)}\n`);
    process.exit(1);
  });
}
