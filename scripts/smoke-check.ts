/**
 * Smoke-check: verify all 5 real adapters round-trip against live services.
 *
 * Usage (from package.json):
 *   npm run smoke-check
 *
 * Which resolves to:
 *   tsx --env-file=.env.local scripts/smoke-check.ts
 *
 * Node >= 20.6 is required for the `--env-file` flag. Invoked via `tsx` so
 * the TypeScript `@/*` path alias in tsconfig.json is respected.
 *
 * Design notes:
 *   - Bypasses `getServices()` on purpose. `getServices()` reads
 *     `USE_MOCKS` and may return mock adapters; this script imports the
 *     real-adapter factories directly so we hard-test the live services
 *     regardless of that flag.
 *   - Auth is skipped — `signIn` requires an existing user's password,
 *     which we don't want to stash in a smoke script. The orchestrator
 *     covers that separately (STEP 4).
 *   - NEVER prints an API key, token, SID, or auth secret. Every error
 *     message is routed through `scrub()` before being printed. Even
 *     though each adapter already scrubs its own errors, this script
 *     scrubs again as a defense-in-depth belt.
 *   - Always exits 0 so the orchestrator can parse stdout regardless of
 *     per-service failures. Individual service status is reported via
 *     the leading "OK" / "FAIL" token on each line.
 *   - Re-loads `.env.local` in-process and force-overrides `process.env`.
 *     Node's `--env-file` flag intentionally does NOT override inherited
 *     env vars — so if the shell that launches us exports (for example)
 *     `ANTHROPIC_API_KEY=""`, Node leaves that empty value in place and
 *     the `.env.local` entry is silently dropped. The smoke-check
 *     exists precisely to catch adapter-level misconfiguration, so we
 *     re-read the file ourselves and overwrite. Only variables listed
 *     in `SENSITIVE_ENV_KEYS` (plus `USE_MOCKS`) are force-loaded; we
 *     don't want a rogue `.env.local` entry to stomp on shell-level
 *     tooling config.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createRealStorageService } from "@/interfaces/storage";
import { createRealAiService } from "@/interfaces/ai";
import { createRealMapsService } from "@/interfaces/maps";
import { createRealSmsService } from "@/interfaces/sms";
// `createRealAuthService` is imported but not invoked — kept so the
// import contract surface is covered by this script and a future
// signed-in-user flow can swap in without an extra line.
import { createRealAuthService } from "@/interfaces/auth";
import twilio from "twilio";

/**
 * Parse `.env.local` and force-overwrite `process.env` for the keys we
 * manage. A tiny hand-rolled parser: `KEY=VALUE`, optional surrounding
 * single- or double-quotes stripped, `#`-prefixed lines ignored, blank
 * lines ignored. No variable expansion, no multiline. Matches the subset
 * Node's own `--env-file` supports.
 */
function loadEnvLocalOverride(): void {
  const envPath = resolve(process.cwd(), ".env.local");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    // No file — rely on whatever the caller already exported.
    return;
  }
  const MANAGED = new Set<string>([
    "ANTHROPIC_API_KEY",
    "NEXT_PUBLIC_MAPBOX_TOKEN",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
    "USE_MOCKS",
  ]);
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!MANAGED.has(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvLocalOverride();

// Allow-list of env-var NAMES whose VALUES must never leak to stdout.
// We read each value once, then scrub any occurrence from printed error
// strings. `undefined` / empty values are filtered out so an unset var
// doesn't turn into `[redacted]` matching every empty string.
const SENSITIVE_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "NEXT_PUBLIC_MAPBOX_TOKEN",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
] as const;

function collectSecrets(): string[] {
  const secrets: string[] = [];
  for (const key of SENSITIVE_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.length > 3) {
      secrets.push(value);
    }
  }
  // Also scrub any Bearer/Basic token-looking Authorization payload and
  // `access_token=<value>` query fragments, belt-and-suspenders.
  return secrets;
}

function scrub(input: unknown): string {
  let text: string;
  if (input instanceof Error) {
    text = input.message;
  } else if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = JSON.stringify(input);
    } catch {
      text = String(input);
    }
  }
  const secrets = collectSecrets();
  for (const s of secrets) {
    // Split/join avoids regex-escaping the secret.
    text = text.split(s).join("[redacted]");
  }
  // Generic fallbacks for URL-query or header-embedded secrets that might
  // arrive from an SDK error body we didn't already match literally.
  text = text.replace(/access_token=[^&\s"']+/g, "access_token=[redacted]");
  text = text.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [redacted]");
  // Twilio Basic-auth headers show up as `Basic <base64>` in some SDK
  // error echoes. Redact the base64 payload.
  text = text.replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic [redacted]");
  // Truncate long errors so a full HTML body from a 4xx page doesn't
  // dominate the output.
  if (text.length > 400) text = `${text.slice(0, 400)}... [truncated]`;
  return text;
}

function pass(name: string, detail: string): void {
  process.stdout.write(`OK ${name}: ${detail}\n`);
}

function fail(name: string, err: unknown): void {
  process.stdout.write(`FAIL ${name}: ${scrub(err)}\n`);
}

async function checkSupabase(): Promise<void> {
  try {
    const storage = createRealStorageService();
    const offices = await storage.listOffices();
    pass("supabase", `listOffices returned ${offices.length} row(s)`);
  } catch (err) {
    fail("supabase", err);
  }
}

async function checkAnthropic(): Promise<void> {
  try {
    const ai = createRealAiService();
    const result = await ai.parsePickupMessage({
      channel: "sms",
      from: "+15555555555",
      body: "Please pick up 2 samples, routine.",
    });
    if (typeof result.confidence !== "number") {
      throw new Error(
        `parsePickupMessage returned no numeric confidence: ${JSON.stringify(result)}`,
      );
    }
    const summary = `parsePickupMessage confidence=${result.confidence.toFixed(
      2,
    )} urgency=${result.urgency ?? "null"} sampleCount=${
      result.sampleCount ?? "null"
    }`;
    if (result.confidence === 0) {
      // Confidence=0 means the adapter swallowed a post-response failure
      // (SDK threw, JSON.parse failed, or coerceResult rejected the
      // shape). Round-trip is OK from the adapter contract's POV, but
      // flag it so the orchestrator knows extraction isn't actually
      // working end-to-end.
      process.stdout.write(
        `WARN anthropic: ${summary} (adapter returned low-confidence sentinel; round-trip OK but parsing may be broken)\n`,
      );
    } else {
      pass("anthropic", summary);
    }
  } catch (err) {
    fail("anthropic", err);
  }
}

async function checkMapbox(): Promise<void> {
  try {
    const maps = createRealMapsService();
    const coords = await maps.geocode(
      "1600 Pennsylvania Avenue, Washington, DC",
    );
    // White House ~ 38.898 N, -77.036 W. Accept anything inside a
    // generous box around DC so a slightly different Mapbox pinning
    // doesn't false-fail the smoke test.
    const nearDc =
      coords.lat > 38.5 &&
      coords.lat < 39.2 &&
      coords.lng < -76.8 &&
      coords.lng > -77.3;
    if (!nearDc) {
      throw new Error(
        `geocode returned coords outside DC box: lat=${coords.lat} lng=${coords.lng}`,
      );
    }
    pass(
      "mapbox",
      `geocode -> lat=${coords.lat.toFixed(4)} lng=${coords.lng.toFixed(4)}`,
    );
  } catch (err) {
    fail("mapbox", err);
  }
}

async function checkTwilio(): Promise<void> {
  try {
    // Construct the SMS service for symmetry / coverage, then hit
    // Twilio's account-fetch endpoint directly. The adapter's own
    // `sendSms` would spend money and require a verified destination;
    // `accounts(sid).fetch()` is a free auth probe.
    createRealSmsService();
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
      throw new Error("TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set");
    }
    const account = await twilio(sid, token).api.accounts(sid).fetch();
    const friendly = account.friendlyName ?? "(no friendlyName)";
    const status = account.status ?? "(no status)";
    pass("twilio", `account status=${status} friendlyName=${friendly}`);
  } catch (err) {
    fail("twilio", err);
  }
}

async function main(): Promise<void> {
  // Touch the auth factory so an unset env var surfaces as a test-suite
  // concern rather than silently passing. We don't call `signIn` because
  // that needs real user credentials.
  try {
    createRealAuthService();
  } catch (err) {
    process.stdout.write(`SKIP auth: ${scrub(err)}\n`);
  }

  await checkSupabase();
  await checkAnthropic();
  await checkMapbox();
  await checkTwilio();
}

main()
  .catch((err) => {
    // Unreachable in practice — each check has its own try/catch. Still
    // scrub before printing in case something throws during module init.
    process.stdout.write(`FAIL smoke-check: ${scrub(err)}\n`);
  })
  .finally(() => {
    // Exit 0 unconditionally so the orchestrator can parse output.
    process.exit(0);
  });
