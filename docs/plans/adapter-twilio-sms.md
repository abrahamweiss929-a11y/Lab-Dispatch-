# Plan: Real Twilio SMS Adapter

**Slug:** adapter-twilio-sms
**SPEC reference:** "Twilio (SMS)" (SPEC.md line 56); "SMS — doctor's office texts the lab's number" (SPEC.md line 17); "Incoming SMS/email → Claude API → extracts sender, urgency, sample count…" (SPEC.md line 40). Consumed by `lib/heads-up.ts` (10-minute office heads-up) and `lib/inbound-pipeline.ts` (auto-reply on inbound messages); powers `SmsService.sendSms` declared in `interfaces/sms.ts`. Discharges the `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` line item in BLOCKERS.md.
**Status:** draft

## Goal

Replace the `NotConfiguredError`-only stub in `interfaces/sms.ts::createRealSmsService` with a working Twilio-backed implementation built on the official `twilio` Node SDK, so that when `USE_MOCKS=false` and the three Twilio env vars are set, `SmsService.sendSms` actually queues a message with Twilio. Mock behavior (`mocks/sms.ts`'s in-memory log) and every existing caller (`maybeNotifyOffice`, `handleInboundMessage`) stay untouched.

## Out of scope

- Inbound webhook receiver + Twilio-signature verification (`X-Twilio-Signature` / `twilio.validateRequest`). That's STEP 4 of the SMS integration and will land in a dedicated feature alongside the inbound route at `app/api/twilio/sms/route.ts`.
- Delivery status webhooks / callbacks (`StatusCallback`). We return `status: "queued"` unconditionally for v1; actual delivery tracking is a separate feature.
- Polling Twilio's API for message status after the initial `messages.create` call.
- MMS / media attachments (`mediaUrl`) — v1 is text-only per SPEC.
- Alphanumeric sender IDs (UK/EU-style) — v1 is US-only per SPEC, sender is a `+1` Twilio number.
- Any change to `mocks/sms.ts` — the deterministic `sms-mock-N` id scheme stays as-is.
- Any change to `interfaces/index.ts` — it already routes `createRealSmsService` through `./sms`, and the re-export keeps that import path working.
- Any change to `lib/heads-up.ts` or `lib/inbound-pipeline.ts` — both consume `sms` through `getServices()` and already handle `sms.sendSms` rejections (heads-up returns `{ status: "error" }` and skips the "notified" flag; inbound-pipeline returns `{ status: "error", messageId }` via the outer try/catch after the message is already stored).
- Any real integration test that hits `api.twilio.com` — all tests mock the `twilio` SDK.
- Changing `SmsSendResult.status` to include richer Twilio states (`sent`, `delivered`, `failed`, `undelivered`). We keep the interface contract (`status: "queued"`) and treat the SDK's own `queued` / `accepted` return as "queued"; a follow-up can widen the union when status callbacks land.

## Architecture decision: use the official `twilio` SDK (not `fetch`)

`interfaces/maps.real.ts` went with raw `fetch` for Mapbox; we deliberately go the other way for Twilio. Trade-offs captured:

- **Auth complexity.** Twilio's REST auth is HTTP Basic with the account SID as username and auth token as password — doable with `fetch` but every call risks accidental `Authorization:` header echo into logs / error strings. The SDK centralizes credential handling and never leaks it through response `.text()`.
- **Request body shape.** `messages.create` takes a `application/x-www-form-urlencoded` body (not JSON). `fetch` callers have to hand-build this with `new URLSearchParams(...)`, which means `body` content lives as a string in memory next to `console.error` — exactly the PHI leak vector we're defending against. The SDK handles encoding internally.
- **Error surface.** The SDK exposes `RestException` with structured `code` / `status` / `moreInfo` fields. Raw `fetch` on non-2xx gives us a Twilio JSON blob that often echoes the request body back. The SDK pre-parses and we can decline to log the structured fields.
- **Footprint.** `twilio` is ~1 MB installed but pure server-side (`"server-only"` import) and already widely used. Not a client-bundle concern.
- **Testability.** `vi.mock("twilio", ...)` with a `vi.hoisted` holder — identical pattern to `interfaces/ai.real.test.ts`'s `vi.mock("@anthropic-ai/sdk", ...)`. No new testing shape.

## Files to create or modify

- `interfaces/sms.real.ts` — **new**. `import "server-only"` module. Exports `createRealSmsService(): SmsService`. Lazy env read via a `getClient()` helper that throws `NotConfiguredError` on first method call when any of `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` is missing. Implements `sendSms` by normalizing `to` via `lib/phone.ts::normalizeUsPhone`, then calling `client.messages.create({ to, from, body })`. Wraps the SDK call in try/catch; logs via `console.error` with a fixed context string only (no SID, no token, no body); rethrows a generic `Error`.
- `interfaces/sms.ts` — **rewrite** into the same shape as `interfaces/auth.ts` / `interfaces/ai.ts` / `interfaces/maps.ts`: keep the interface + param/result type exports (`SmsSendParams`, `SmsSendResult`, `SentSmsRecord`, `SmsService`), drop the inline stubbed `createRealSmsService`, drop the `NotConfiguredError` import (no longer used here), and re-export `createRealSmsService` from `./sms.real`.
- `interfaces/sms.real.test.ts` — **new**. Mocks `twilio` via `vi.mock("twilio", ...)` using the `vi.hoisted` holder pattern from `interfaces/ai.real.test.ts`. Covers: happy path, missing env var → `NotConfiguredError`, unparseable phone → throws before SDK call, SDK throws → caught + logged + rethrown generic, from number normalized, and a defense-in-depth regex sweep that no `console.error` argument contains the account SID, the auth token, or the message body.
- `package.json` — **add dependency** `twilio` (latest stable `^5`). Add to `dependencies` (not `devDependencies`) so `npm install` on the production server pulls it.

No other file needs to change:
- `interfaces/index.ts` already imports `createRealSmsService` from `./sms` — the re-export keeps that import path working.
- `mocks/sms.ts` uses only `import type { ... } from "@/interfaces/sms"` — still resolves after the rewrite since type exports are preserved.
- `lib/heads-up.ts` and `lib/inbound-pipeline.ts` consume `sms` via `getServices()` — unaffected.
- `BLOCKERS.md` — not edited by this plan (the line item is satisfied once the builder lands the code; a separate housekeeping pass can strike it from BLOCKERS).

## Interfaces / contracts

No interface shape change. `SmsSendParams`, `SmsSendResult`, `SentSmsRecord`, `SmsService` stay exactly as they are in `interfaces/sms.ts`:

```ts
export interface SmsSendParams {
  to: string;
  body: string;
}
export interface SmsSendResult {
  id: string;
  status: "queued";
}
export interface SmsService {
  sendSms(params: SmsSendParams): Promise<SmsSendResult>;
}
```

Hard invariants the real adapter must uphold:

- **`import "server-only"`.** Webpack/Next will hard-error if anyone pulls `interfaces/sms.real.ts` into a Client Component. `TWILIO_AUTH_TOKEN` is a true secret; the `"server-only"` seam is a non-negotiable defense.
- **No credentials in logs.** `console.error` calls include a fixed context string and nothing that closes over the account SID, the auth token, or the resulting `messages.create` error's `.response` / `.config` (the SDK's error can echo Basic-auth `Authorization` headers). Defense in depth: the test suite regex-sweeps every `console.error` argument.
- **No message body in logs.** SPEC permits sample lab-pickup messages which may contain office names, patient-adjacent context, sample counts, and ad-hoc free text — all PHI-adjacent. Even on SDK error we MUST NOT log `params.body`. The test suite regex-sweeps for this too.
- **Lazy `NotConfiguredError`.** Missing env var throws only at `sendSms()` call time (not at `createRealSmsService()` construction), matching `interfaces/ai.real.ts`'s `getClient()` pattern and `interfaces/maps.real.ts`'s `getToken()`. Keeps `getServices()` cheap when `USE_MOCKS=false` but callers never touch SMS. The `NotConfiguredError.envVar` reports the FIRST missing var in a fixed priority order (`TWILIO_ACCOUNT_SID` → `TWILIO_AUTH_TOKEN` → `TWILIO_FROM_NUMBER`) so error messages are deterministic across environments.
- **Phone normalization before the SDK call.** `params.to` runs through `normalizeUsPhone` (from `lib/phone.ts`) before we hand it to Twilio. If normalization returns `null`, throw `new Error("sms.sendSms: invalid destination phone number")` BEFORE any SDK call — no network, no log. `from` is also normalized once (lazily, in `getClient()`) from `TWILIO_FROM_NUMBER`; if that normalization fails, it's a `NotConfiguredError` (because a misconfigured sender is a config problem, not a per-call failure).
- **Generic thrown errors on SDK failure.** The SDK's own exception types (`RestException`, network errors) are caught; `console.error` fires with the fixed context string ONLY; we then `throw new Error("sms.sendSms: Twilio send failed")`. The caller (`maybeNotifyOffice` / `handleInboundMessage`) sees a plain `Error` and handles it as they already do.
- **Return shape.** On success, return `{ id: message.sid, status: "queued" as const }`. `message.sid` is Twilio's `SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` string. We deliberately don't forward the SDK's actual `message.status` (which is typically `"queued"` or `"accepted"` at this stage) — the interface contract locks status to the literal `"queued"`, and widening that union is a separate feature.

### SDK surface we depend on

```ts
import twilio from "twilio";
const client = twilio(accountSid, authToken);
const message = await client.messages.create({
  to,    // E.164 string, e.g. "+15551234567"
  from,  // E.164 string, our Twilio sender number
  body,  // plain text
});
// message.sid: string (starts with "SM")
// message.status: "queued" | "accepted" | ...  (we ignore)
```

## Implementation steps

1. **Install dep.** Run `npm install twilio@^5` — no `--save-dev`; must land in `dependencies`. (Builder step, captured here so it's not forgotten.)

2. **Create `interfaces/sms.real.ts`** with the preamble:
   - `import "server-only";`
   - `import twilio from "twilio";`
   - `import { NotConfiguredError } from "@/lib/errors";`
   - `import { normalizeUsPhone } from "@/lib/phone";`
   - `import type { SmsSendParams, SmsSendResult, SmsService } from "./sms";`

3. **Top-of-file doc comment** explaining the four cardinal rules, mirroring `ai.real.ts`'s preamble style:
   - Hermetic-by-default: tests mock `twilio`; no real HTTP from the test suite.
   - `"server-only"` protects `TWILIO_AUTH_TOKEN` from the client bundle.
   - Lazy env resolution: `NotConfiguredError` fires on first method call, not at construction.
   - PHI / credential boundary: neither the account SID, the auth token, nor the message body is ever passed to `console.error` or included in a thrown `Error.message`.

4. **Implement `createRealSmsService()`** (mirrors `createRealAiService` lazy pattern):
   ```ts
   interface CachedClient {
     client: ReturnType<typeof twilio>;
     from: string;
   }
   export function createRealSmsService(): SmsService {
     let cached: CachedClient | null = null;

     function getClient(): CachedClient {
       if (cached !== null) return cached;
       const accountSid = process.env.TWILIO_ACCOUNT_SID;
       if (!accountSid) {
         throw new NotConfiguredError({
           service: "sms (Twilio)",
           envVar: "TWILIO_ACCOUNT_SID",
         });
       }
       const authToken = process.env.TWILIO_AUTH_TOKEN;
       if (!authToken) {
         throw new NotConfiguredError({
           service: "sms (Twilio)",
           envVar: "TWILIO_AUTH_TOKEN",
         });
       }
       const rawFrom = process.env.TWILIO_FROM_NUMBER;
       if (!rawFrom) {
         throw new NotConfiguredError({
           service: "sms (Twilio)",
           envVar: "TWILIO_FROM_NUMBER",
         });
       }
       const from = normalizeUsPhone(rawFrom);
       if (from === null) {
         throw new NotConfiguredError({
           service: "sms (Twilio)",
           envVar: "TWILIO_FROM_NUMBER",
         });
       }
       cached = { client: twilio(accountSid, authToken), from };
       return cached;
     }

     async function sendSms(params: SmsSendParams): Promise<SmsSendResult> {
       const to = normalizeUsPhone(params.to);
       if (to === null) {
         throw new Error("sms.sendSms: invalid destination phone number");
       }
       const { client, from } = getClient();
       try {
         const message = await client.messages.create({
           to,
           from,
           body: params.body,
         });
         return { id: message.sid, status: "queued" as const };
       } catch {
         // DO NOT include the SDK error object, its message, the SID, the
         // token, or `params.body` in any log arg — Twilio's error
         // strings can echo back the request body, and `params.body` is
         // PHI-adjacent. A fixed context string is the entire payload.
         console.error("sms.sendSms: Twilio send failed");
         throw new Error("sms.sendSms: Twilio send failed");
       }
     }

     return { sendSms };
   }
   ```
   - The `catch` block deliberately omits the error identifier entirely. We do not bind `(err)` because there is no use for it that doesn't risk leaking credentials or body content via the SDK's error-string conventions (some SDKs stuff `Authorization` headers into `err.config`). If future debugging needs more signal, add Sentry-with-pre-send-scrub, not `console.error(err)`.
   - Client + normalized `from` are cached together on the first successful `getClient()` call. This matches `ai.real.ts`'s `cachedClient` pattern and avoids re-normalizing `TWILIO_FROM_NUMBER` on every send.

5. **Rewrite `interfaces/sms.ts`** to mirror `interfaces/ai.ts` / `interfaces/maps.ts`:
   - Keep `SmsSendParams`, `SmsSendResult`, `SentSmsRecord`, `SmsService` exports unchanged (mocks depend on the type shape).
   - Delete the `NotConfiguredError` import — no longer used here.
   - Delete the inline `createRealSmsService` stub (the entire `return { async sendSms(...) { throw new NotConfiguredError(...) } }` block).
   - Append `export { createRealSmsService } from "./sms.real";` with a two-line comment matching the `ai.ts` / `maps.ts` re-exports: "The real adapter lives in a `\"server-only\"` module so webpack errors if anyone accidentally pulls it into a Client Component. Callers continue to import the interface + helper types from this file."
   - Confirm `mocks/sms.ts`'s `import type { ... } from "@/interfaces/sms"` still resolves — it will, since the type exports stay.
   - Confirm `interfaces/index.ts` already imports `createRealSmsService` from `./sms` — no change there.

6. **Write `interfaces/sms.real.test.ts`** (see **Tests to write**). Follow the `vi.mock("@anthropic-ai/sdk", ...)` + `vi.hoisted` pattern from `interfaces/ai.real.test.ts`. `vi.stubEnv` for the three env vars; `vi.resetModules()` between env-mutating cases; `vi.unstubAllEnvs()` in `afterEach`. No real network.

7. **Verify** locally (builder agent runs these, not planner):
   - `npx tsc --noEmit` — types clean (this catches any shape drift between the rewritten `sms.ts` re-export and consumers).
   - `npx vitest run interfaces/sms.real.test.ts` — new test file green.
   - `npx vitest run` — full suite unaffected (`interfaces/index.test.ts` already exercises `getServices()` routing; it must keep passing).

## Tests to write

All in `interfaces/sms.real.test.ts`. All use `vi.mock("twilio", ...)` with `vi.hoisted` plus `vi.stubEnv` for the three env vars; `vi.resetModules()` between env-mutating cases; `vi.unstubAllEnvs()` in `afterEach`. No real network.

### Setup scaffold (modeled on `interfaces/ai.real.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  holder: { current: vi.fn() as ReturnType<typeof vi.fn> },
  ctorSpy: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock("twilio", () => {
  const factory = (sid: string, token: string) => {
    hoisted.ctorSpy(sid, token);
    return { messages: { create: hoisted.holder.current } };
  };
  return { default: factory };
});

import type { SmsService } from "./sms";

const STUB_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const STUB_TOKEN = "test-auth-token-abc123";
const STUB_FROM_RAW = "(415) 555-0100";
const STUB_FROM_E164 = "+14155550100";
```

`beforeEach` stubs all three env vars, resets modules, resets the two hoisted mocks, spies on `console.error`, then `await import("./sms.real")` and `createRealSmsService()`.

### Test cases

- **"returns { id, status: 'queued' } on happy path and passes normalized to/from/body to messages.create"**
  `hoisted.holder.current.mockResolvedValueOnce({ sid: "SM123abc" })`. Call `service.sendSms({ to: "(415) 555-0199", body: "hello" })`. Assert result is exactly `{ id: "SM123abc", status: "queued" }`. Inspect `hoisted.holder.current.mock.calls[0][0]`: must equal `{ to: "+14155550199", from: STUB_FROM_E164, body: "hello" }`. Assert `errorSpy` not called.

- **"normalizes the TWILIO_FROM_NUMBER env var (not only the per-call `to`)"**
  Uses `STUB_FROM_RAW = "(415) 555-0100"`. After a happy-path send, assert the `from` field handed to `messages.create` is the E.164 form `"+14155550100"` — proves `TWILIO_FROM_NUMBER` is normalized once at client construction, not passed raw.

- **"throws Error on unparseable destination phone and does NOT call messages.create"**
  Call `service.sendSms({ to: "not a phone", body: "hi" })`. Assert rejects with `/invalid destination phone number/`. Assert `hoisted.holder.current` was NOT called — no network attempt on bad input.

- **"throws NotConfiguredError(envVar='TWILIO_ACCOUNT_SID') when SID is unset"**
  `vi.stubEnv("TWILIO_ACCOUNT_SID", "")`, `vi.resetModules()`, re-import, construct service. Call `sendSms({ to: "+15551234567", body: "x" })`. Assert rejects with a `NotConfiguredError` whose `.envVar === "TWILIO_ACCOUNT_SID"`.

- **"throws NotConfiguredError(envVar='TWILIO_AUTH_TOKEN') when only the token is unset"**
  SID + FROM are set; token is cleared. Same flow. Assert `.envVar === "TWILIO_AUTH_TOKEN"`.

- **"throws NotConfiguredError(envVar='TWILIO_FROM_NUMBER') when only FROM is unset"**
  SID + token set; FROM cleared. Same flow. Assert `.envVar === "TWILIO_FROM_NUMBER"`.

- **"throws NotConfiguredError(envVar='TWILIO_FROM_NUMBER') when FROM is set but unparseable"**
  `vi.stubEnv("TWILIO_FROM_NUMBER", "not-a-phone")`. Call sendSms. Assert `NotConfiguredError` with `envVar === "TWILIO_FROM_NUMBER"` — a misconfigured sender is a config problem, not a per-call runtime error.

- **"catches SDK throw, logs a fixed context string, rethrows generic Error"**
  `hoisted.holder.current.mockRejectedValueOnce(Object.assign(new Error("RestException: auth failed, accountSid=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx, token=test-auth-token-abc123, body=some-sensitive-text"), { code: 20003 }))`. Call sendSms with `body: "patient name + sample count 3"`. Assert rejects with `/Twilio send failed/`. Assert the rethrown `Error.message` does NOT contain `STUB_SID`, does NOT contain `STUB_TOKEN`, does NOT contain the SDK's message, and does NOT contain the caller's `body`. Assert `errorSpy` called exactly once.

- **"no console.error argument contains accountSid, authToken, or message body (defense-in-depth regex sweep)"**
  Reuses the SDK-throws scenario above (error message crafted to contain all three sensitive strings). Flatten every `console.error` argument to a string (string args kept as-is; Errors → `.message`; objects → `JSON.stringify` wrapped in try/catch). Assert:
    - `/ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/` matches none.
    - `/test-auth-token-abc123/` matches none.
    - `/patient name \+ sample count 3/` matches none.
  Belt-and-suspenders check against regression: if someone later "helpfully" adds `console.error("...", err)` or `console.error("... body=", params.body)`, this test fails.

- **"client is constructed with the correct (sid, token) and cached across calls"**
  Happy-path send → second happy-path send (both using the same service instance). Assert `hoisted.ctorSpy` was called exactly once with `(STUB_SID, STUB_TOKEN)`. Proves credential handoff + client caching.

- **"no call to messages.create when NotConfiguredError fires"**
  Env cleared as in the first NotConfigured test. Assert `hoisted.holder.current` was NOT called. Belt-and-suspenders against a regression where the lazy check accidentally slips below the SDK call.

## External services touched

- **Twilio** — REST endpoint `POST /2010-04-01/Accounts/{AccountSid}/Messages.json`, wrapped by `interfaces/sms.ts` (types + re-export) and `interfaces/sms.real.ts` (server-only SDK-based impl). Requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (US `+1` phone number purchased via Twilio console). Consumed from `lib/heads-up.ts` (10-minute office heads-up) and `lib/inbound-pipeline.ts` (inbound auto-reply), plus any future dispatcher-send surface — all via `getServices().sms`.

One new npm dependency: **`twilio`** (`^5`, added to `dependencies`).

## Open questions

None.
