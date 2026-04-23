# Plan: Real Anthropic AI Adapter

**Slug:** adapter-anthropic-ai
**SPEC reference:** inbound pickup parsing (BLOCKERS.md `[anthropic]`); consumed by `lib/inbound-pipeline.ts`
**Status:** draft

## Goal

Replace the stub in `interfaces/ai.ts::createRealAiService` with a working Anthropic-backed implementation of `AiService.parsePickupMessage`, so that when `USE_MOCKS=false` and `ANTHROPIC_API_KEY` is set, inbound SMS/email bodies are parsed into `{ urgency, sampleCount, specialInstructions, confidence }` via Claude Haiku. Mock behavior and every existing caller stay untouched.

## Out of scope

- Prompt caching (follow-up if token cost grows — SPEC unchanged).
- Structured tool use / tool-calls — v1 parses a JSON string from the text block.
- Streaming responses.
- Any `AiService` methods other than `parsePickupMessage` (none exist on the interface yet).
- Changes to `lib/inbound-pipeline.ts` — the pipeline already consumes `AiService` via `getServices()` and handles low-confidence as flagged.
- Changes to `mocks/ai.ts` — deterministic keyword heuristic stays as-is for pipeline tests.
- A real integration test that hits Anthropic — all tests mock `@anthropic-ai/sdk`.

## Files to create or modify

- `package.json` — add `@anthropic-ai/sdk` to `dependencies`.
- `package-lock.json` — updated by `npm install`.
- `interfaces/ai.real.ts` — **new**. Server-only module. Exports `createRealAiService(): AiService`. Constructs `new Anthropic({ apiKey })`; throws `NotConfiguredError` if `ANTHROPIC_API_KEY` is missing/empty; implements `parsePickupMessage` with Haiku, JSON-string extraction, input truncation, and total error containment.
- `interfaces/ai.ts` — **rewrite** into the same shape as `interfaces/auth.ts`: keep the interface + param/result type exports, drop the inline stub, and re-export `createRealAiService` from `./ai.real`.
- `interfaces/ai.real.test.ts` — **new**. Mocks `@anthropic-ai/sdk` with `vi.mock`, covers happy path, extra fields dropped, non-JSON response, SDK throw, missing env var (via `vi.stubEnv` + dynamic import + `vi.resetModules`), model-id assertion, body-truncation assertion.
- `BLOCKERS.md` — move `[anthropic]` from **Unresolved** to a new **Resolved** section (or mark inline) with a one-line note that the real adapter now lives in `interfaces/ai.real.ts`. Keep the workaround note for historical reference.

## Interfaces / contracts

No interface shape change — `AiService`, `ParsePickupMessageParams`, `ParsePickupMessageResult` stay exactly as they are in `interfaces/ai.ts`. The method contract the real adapter must satisfy:

```ts
parsePickupMessage(params: {
  channel: "sms" | "email";
  from: string;
  body: string;
}): Promise<{
  urgency?: "routine" | "urgent" | "stat";
  sampleCount?: number;
  specialInstructions?: string;
  confidence: number; // 0..1
}>;
```

Hard invariants the real adapter must uphold:

- Never throws. Every failure path resolves to `{ confidence: 0 }` so the pipeline treats it as low-confidence / flagged.
- Never logs API key material — not full, not masked, not first/last N.
- Must be `"server-only"` (webpack blows up if pulled into a Client Component).

### Prompt contract (system prompt Claude receives)

Single system prompt, plain string. Structure:

1. Role: "You are a lab-pickup message parser."
2. Task: extract four fields from an SMS or email body.
3. Field dictionary:
   - `urgency`: `"routine"` | `"urgent"` | `"stat"` | `null`. Scale: `routine` = no rush / same-day, `urgent` = ASAP / rush, `stat` = STAT / immediate / clinical stat.
   - `sampleCount`: integer ≥ 1 if the sender states a count, else `null`.
   - `specialInstructions`: any free-text notes (e.g., "back entrance", "after 3pm"), else `null`.
   - `confidence`: float in `[0, 1]` — the parser's self-assessed confidence that the extraction is correct.
4. Closing line: **"Return only JSON — no prose, no markdown fences."**

The user message is the raw pickup body, truncated to 4000 chars.

## Implementation steps

1. **Install the SDK.** Run `npm install @anthropic-ai/sdk` (pins the latest compatible 0.x). Verify `package-lock.json` updated. No other deps.

2. **Create `interfaces/ai.real.ts`** with this skeleton:
   - `import "server-only";`
   - `import Anthropic from "@anthropic-ai/sdk";`
   - `import { NotConfiguredError } from "@/lib/errors";`
   - `import type { AiService, ParsePickupMessageParams, ParsePickupMessageResult } from "./ai";`
   - Module-level constants:
     - `const MODEL_ID = "claude-haiku-4-5-20251001";` — Haiku is cheap, fast, and adequate for structured extraction from short messages. Doc-comment the choice (cost/latency) and note that Sonnet is the escalation if accuracy regresses.
     - `const MAX_BODY_CHARS = 4000;` — caps cost on pathological long emails. Doc-comment: "Past 4000 chars (~1000 tokens of body) we truncate; dispatcher sees the full raw message elsewhere in `messages.body`."
     - `const MAX_OUTPUT_TOKENS = 256;` — JSON response is ~100 tokens; 256 gives headroom for `specialInstructions`.
     - `const SYSTEM_PROMPT` string literal — the prompt contract above.
     - `const LOW_CONFIDENCE: ParsePickupMessageResult = { confidence: 0 };` — reused on every failure path.

3. **Implement `createRealAiService()`**:
   - Read `process.env.ANTHROPIC_API_KEY`. If missing or empty string, throw `new NotConfiguredError({ service: "ai (Anthropic)", envVar: "ANTHROPIC_API_KEY" })` — same pattern as the current stub, matches `interfaces/auth.ts` + `interfaces/storage.ts` behavior.
   - Construct `const client = new Anthropic({ apiKey });` once per `createRealAiService()` call.
   - Return an `AiService` whose `parsePickupMessage` delegates to an inner async function (step 4).

4. **Implement `parsePickupMessage(params)`**:
   - `const body = params.body.slice(0, MAX_BODY_CHARS);` — truncation happens before sending.
   - Wrap the entire SDK call + parse in a single `try { ... } catch { ... }`.
   - Inside `try`:
     - `const resp = await client.messages.create({ model: MODEL_ID, max_tokens: MAX_OUTPUT_TOKENS, system: SYSTEM_PROMPT, messages: [{ role: "user", content: body }] });`
     - Pull the text: find the first `content` block of `type === "text"` on `resp.content`. If none, `return LOW_CONFIDENCE;`.
     - `const parsed = JSON.parse(text);` — wrapped in its own `try/catch`; on throw, `return LOW_CONFIDENCE;`.
     - Shape-validate with an inline guard `coerceResult(parsed)` (step 5). If it returns `null`, `return LOW_CONFIDENCE;`.
     - Otherwise return the coerced result.
   - `catch (err)`:
     - `console.error("ai.parsePickupMessage: Anthropic call failed", err instanceof Error ? err.message : String(err));` — logs only the SDK's error message. The SDK masks keys in its own error strings, but we do not add any key-derived data to the log. Do not log headers, response bodies, or the API-key variable in any form.
     - `return LOW_CONFIDENCE;`

5. **Inline `coerceResult(raw: unknown): ParsePickupMessageResult | null`** (small guard, not a library):
   - Reject if `raw` is not a plain object.
   - `confidence` must be a finite number in `[0, 1]` — otherwise return `null` (treats malformed confidence as total failure).
   - `urgency`: accept only `"routine" | "urgent" | "stat"`; any other value (including `null`) drops the field (result omits it — pipeline defaults to `"routine"`).
   - `sampleCount`: accept only integers ≥ 1 and ≤ 99 (matches mock's 1..99 heuristic). Anything else drops the field.
   - `specialInstructions`: accept only non-empty trimmed strings; max length 500 chars (truncate silently). Anything else drops the field.
   - Any other keys on the object are ignored — "extra fields dropped" is deliberate so Claude can over-return without breaking us.

6. **Rewrite `interfaces/ai.ts`** to mirror `interfaces/auth.ts`:
   - Keep the `ParsePickupMessageParams`, `ParsePickupMessageResult`, `AiService` exports unchanged.
   - Delete the inline `createRealAiService` stub.
   - Append `export { createRealAiService } from "./ai.real";` with the same two-line comment the `auth.ts` / `storage.ts` re-exports use ("The real adapter lives in a `"server-only"` module …").
   - Confirm `mocks/ai.ts`'s `import type { AiService, ParsePickupMessageParams, ParsePickupMessageResult } from "@/interfaces/ai";` still resolves — it will, since the type exports stay.
   - Confirm `interfaces/index.ts` / `getServices()` already picks `createRealAiService` through the same name — no change needed there if it already routes through `interfaces/ai`.

7. **Write `interfaces/ai.real.test.ts`** following the same `vi.hoisted` + dynamic-import pattern used by `interfaces/auth.real.test.ts`:
   - Hoist a `holder` ref for the fake `messages.create` mock.
   - `vi.mock("@anthropic-ai/sdk", () => ({ default: vi.fn(() => ({ messages: { create: hoisted.holder.current } })) }));` — the SDK default export is the `Anthropic` class; mocking with a constructor-style factory keeps `new Anthropic(...)` cheap.
   - In `beforeEach`, `vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");`, `vi.resetModules()`, set `hoisted.holder.current = vi.fn();`, then `const mod = await import("./ai.real"); service = mod.createRealAiService();`.
   - In `afterEach`, `vi.unstubAllEnvs();`.
   - Test cases listed in **Tests to write** below.

8. **Update `BLOCKERS.md`**:
   - Under `### [anthropic]`, either move the entry into a new `## Resolved` section (preferred — mirrors likely future pattern) or inline-mark it `**Status: DONE (real adapter shipped).**`.
   - Add one line: "Real adapter lives in `interfaces/ai.real.ts`; tests in `interfaces/ai.real.test.ts`. `ANTHROPIC_API_KEY` is still required at runtime but is no longer a build blocker — `createRealAiService()` throws `NotConfiguredError` with a friendly message when the var is missing."
   - Keep the `Workaround in place` line for historical context.

9. **Verify** locally by running (the builder agent, not planner):
   - `npx tsc --noEmit` — types clean.
   - `npx vitest run interfaces/ai.real.test.ts` — new test file green.
   - `npx vitest run` — full suite unaffected.

## Tests to write

- `interfaces/ai.real.test.ts`:
  - **"returns parsed object on happy path"** — mock `messages.create` to resolve `{ content: [{ type: "text", text: JSON.stringify({ urgency: "urgent", sampleCount: 3, specialInstructions: "back entrance", confidence: 0.82 }) }] }`. Assert the adapter returns that object shape exactly.
  - **"ignores extra fields in Claude's JSON response"** — response JSON includes a `note: "..."` and an unknown `priority: 9`; assert the result contains only the four documented fields.
  - **"returns { confidence: 0 } when response text is not valid JSON"** — mock returns `{ content: [{ type: "text", text: "sorry, can't help" }] }`. Assert `{ confidence: 0 }` and `console.error` was NOT called (non-JSON is not an error path, per the guard).
  - **"returns { confidence: 0 } when JSON parses but shape is wrong"** — `{ confidence: "high" }` (non-numeric). Assert `{ confidence: 0 }`.
  - **"returns { confidence: 0 } and does not throw when SDK rejects"** — mock `messages.create` to `.mockRejectedValueOnce(new Error("rate_limit"))`. Assert the promise resolves to `{ confidence: 0 }` and `console.error` fired with a string that does NOT contain `"sk-ant-test"` (regex the stubbed key against the logged argument — defense in depth on the logging rule).
  - **"throws NotConfiguredError when ANTHROPIC_API_KEY is unset"** — `vi.stubEnv("ANTHROPIC_API_KEY", "")`, `vi.resetModules()`, re-import `./ai.real`. Expect `createRealAiService()` to throw a `NotConfiguredError` with `envVar === "ANTHROPIC_API_KEY"`.
  - **"calls messages.create with model `claude-haiku-4-5-20251001`"** — after the happy-path call, inspect `messages.create.mock.calls[0][0].model` and assert the literal string.
  - **"truncates body input to 4000 characters before sending"** — call with `body: "x".repeat(5000)`. Inspect `messages.create.mock.calls[0][0].messages[0].content` and assert its length is exactly 4000.
  - **"forwards system prompt containing 'Return only JSON'"** — sanity check that the system string the SDK receives includes the closing directive, so a future prompt edit that drops it fails this test.

All of the above use the mocked SDK — **no real network calls** at any point. No live-API smoke test is added in this feature; that's a manual verification step when the user adds `ANTHROPIC_API_KEY`.

## External services touched

- **Anthropic** — via `@anthropic-ai/sdk`, wrapped by `interfaces/ai.ts` (types + re-export) and `interfaces/ai.real.ts` (server-only impl). Requires `ANTHROPIC_API_KEY`. Consumed from `lib/inbound-pipeline.ts` via `getServices().ai`.

No other external services are touched by this change.

## Open questions

None.
