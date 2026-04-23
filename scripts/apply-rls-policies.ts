/**
 * apply-rls-policies: extract the "Row Level Security — Policies" block from
 * supabase/schema.sql and print it to stdout.
 *
 * Usage (from package.json):
 *   npm run apply-rls-policies
 *
 * Which resolves to:
 *   tsx --env-file=.env.local scripts/apply-rls-policies.ts
 *
 * Design notes:
 *   - This script NEVER connects to a database. It just slices the policies
 *     section out of the canonical schema file and prints it so an operator
 *     can paste it into the Supabase SQL editor:
 *       Project → SQL → New query → paste → Run.
 *   - The markers `-- BEGIN RLS POLICIES --` and `-- END RLS POLICIES --`
 *     are the stable contract. If either is missing or the block is empty
 *     this script exits non-zero so the build catches schema drift.
 *   - No `pg`, `@supabase/supabase-js`, or network imports — the whole point
 *     of this script is to keep the one-time policy apply hands-off of any
 *     runtime credential.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BEGIN_MARKER = "-- BEGIN RLS POLICIES --";
const END_MARKER = "-- END RLS POLICIES --";

function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(here, "../supabase/schema.sql");
  const sql = readFileSync(schemaPath, "utf8");

  const beginIdx = sql.indexOf(BEGIN_MARKER);
  const endIdx = sql.indexOf(END_MARKER);

  if (beginIdx === -1) {
    throw new Error(
      `apply-rls-policies: missing "${BEGIN_MARKER}" in ${schemaPath}`,
    );
  }
  if (endIdx === -1) {
    throw new Error(
      `apply-rls-policies: missing "${END_MARKER}" in ${schemaPath}`,
    );
  }
  if (endIdx <= beginIdx) {
    throw new Error(
      `apply-rls-policies: "${END_MARKER}" appears before "${BEGIN_MARKER}" in ${schemaPath}`,
    );
  }

  const block = sql.slice(beginIdx, endIdx + END_MARKER.length).trim();
  if (block.length <= BEGIN_MARKER.length + END_MARKER.length + 8) {
    throw new Error(
      `apply-rls-policies: policies block between markers is empty in ${schemaPath}`,
    );
  }

  process.stdout.write(
    [
      "-- Lab Dispatch — Row Level Security policies",
      "-- Paste into Supabase SQL Editor: Project -> SQL -> New query -> Run.",
      "-- Re-runnable: every create policy is paired with a drop policy if exists.",
      "",
      block,
      "",
    ].join("\n"),
  );
}

try {
  main();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}
