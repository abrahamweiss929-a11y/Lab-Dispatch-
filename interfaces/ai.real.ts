import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { NotConfiguredError } from "@/lib/errors";
import type {
  AiService,
  ParsePickupMessageParams,
  ParsePickupMessageResult,
} from "./ai";

/**
 * Real Anthropic-backed implementation of `AiService.parsePickupMessage`.
 *
 * Design constraints:
 *   - Hermetic-by-default: tests mock `@anthropic-ai/sdk`; no real network
 *     call is ever made from the test suite.
 *   - Never throws. Every failure path (missing text block, JSON parse,
 *     shape validation, SDK error) resolves to `{ confidence: 0 }` so the
 *     pipeline treats the extraction as low-confidence / flagged.
 *   - Never logs API key material — not the full key, not a mask, not
 *     first/last N characters. Any SDK error that surfaces is logged with
 *     a context string and `err.message` only. The SDK itself masks keys
 *     in its own error strings but we make no assumptions beyond that.
 *   - `"server-only"`: webpack/Next will hard-error if this file is pulled
 *     into a Client Component, protecting `ANTHROPIC_API_KEY` from ever
 *     reaching the browser bundle.
 */

// Haiku is cheap, fast, and adequate for structured extraction from short
// SMS / email bodies. If extraction quality regresses, the first
// escalation is Sonnet (same API shape, swap the model id).
const MODEL_ID = "claude-haiku-4-5-20251001";

// Past ~4000 chars (~1000 tokens of body text) we truncate before sending
// to bound per-call cost on pathological long emails. The dispatcher
// still sees the full raw message elsewhere via `messages.body`.
const MAX_BODY_CHARS = 4000;

// Typical JSON response is ~100 tokens; 256 leaves headroom for a longer
// `specialInstructions` string.
const MAX_OUTPUT_TOKENS = 256;

const SYSTEM_PROMPT = [
  "You are a lab-pickup message parser.",
  "",
  "Extract four fields from an SMS or email body sent by a medical office",
  "requesting a lab-sample pickup:",
  "",
  '- urgency: one of "routine" (no rush / same-day), "urgent" (ASAP / rush),',
  '  "stat" (STAT / immediate / clinical stat), or null if not stated.',
  "- sampleCount: integer >= 1 if the sender states a count, else null.",
  '- specialInstructions: any free-text notes (e.g. "back entrance",',
  '  "after 3pm"), else null.',
  "- confidence: float in [0, 1] — your self-assessed confidence that the",
  "  extraction is correct.",
  "",
  "Return only JSON — no prose, no markdown fences.",
].join("\n");

const LOW_CONFIDENCE: ParsePickupMessageResult = { confidence: 0 };

const ALLOWED_URGENCIES = new Set(["routine", "urgent", "stat"]);
const MAX_SPECIAL_INSTRUCTIONS_CHARS = 500;

/**
 * Strip a single optional leading markdown code fence (``` or ```json …) and
 * a single optional trailing ``` fence from an otherwise-JSON string.
 *
 * Claude Haiku/Sonnet frequently wraps structured JSON in ```json fences
 * even when the system prompt explicitly asks for "no prose, no markdown
 * fences" — the model is trained hard enough on code-block formatting
 * that suppression is best-effort, not guaranteed. Parsing the raw text
 * without stripping collapsed every fenced response to `{ confidence: 0 }`.
 *
 * The regexes are intentionally conservative:
 *   - leading:  optional language tag, optional newline
 *   - trailing: optional newline, optional whitespace
 * so unfenced responses pass through unchanged (backward-compat for the
 * mocked-SDK test suite and for the minority of responses that obeyed
 * the prompt).
 */
export function stripJsonFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/, "");
}

function coerceResult(raw: unknown): ParsePickupMessageResult | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  const confidence = obj.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return null;
  }
  if (confidence < 0 || confidence > 1) {
    return null;
  }

  const out: ParsePickupMessageResult = { confidence };

  const urgency = obj.urgency;
  if (typeof urgency === "string" && ALLOWED_URGENCIES.has(urgency)) {
    out.urgency = urgency as ParsePickupMessageResult["urgency"];
  }

  const sampleCount = obj.sampleCount;
  if (
    typeof sampleCount === "number" &&
    Number.isInteger(sampleCount) &&
    sampleCount >= 1 &&
    sampleCount <= 99
  ) {
    out.sampleCount = sampleCount;
  }

  const specialInstructions = obj.specialInstructions;
  if (typeof specialInstructions === "string") {
    const trimmed = specialInstructions.trim();
    if (trimmed.length > 0) {
      out.specialInstructions = trimmed.slice(0, MAX_SPECIAL_INSTRUCTIONS_CHARS);
    }
  }

  return out;
}

export function createRealAiService(): AiService {
  // Env check + client construction are deferred to first use — matches
  // the storage / auth real adapters, which lazily resolve Supabase env
  // via their shared client getter. This keeps `getServices()` cheap
  // (no side-effect on construction), lets callers that never invoke
  // `parsePickupMessage` under `USE_MOCKS=false` boot, and makes
  // `NotConfiguredError` surface at the call site where the user can see
  // which feature tripped it.
  let cachedClient: Anthropic | null = null;
  function getClient(): Anthropic {
    if (cachedClient !== null) return cachedClient;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new NotConfiguredError({
        service: "ai (Anthropic)",
        envVar: "ANTHROPIC_API_KEY",
      });
    }
    cachedClient = new Anthropic({ apiKey });
    return cachedClient;
  }

  async function parsePickupMessage(
    params: ParsePickupMessageParams,
  ): Promise<ParsePickupMessageResult> {
    const body = params.body.slice(0, MAX_BODY_CHARS);
    // `getClient()` can throw `NotConfiguredError` on the first call.
    // That throw is intentional and must NOT be caught by the SDK-error
    // try/catch below — callers (e.g. `getServices()`) treat
    // `NotConfiguredError` as a configuration problem, distinct from the
    // "low confidence, carry on" signal that everything else resolves to.
    const client = getClient();
    try {
      const resp = await client.messages.create({
        model: MODEL_ID,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: body }],
      });

      const textBlock = resp.content.find(
        (block) => (block as { type?: string }).type === "text",
      ) as { type: "text"; text: string } | undefined;
      if (!textBlock || typeof textBlock.text !== "string") {
        return LOW_CONFIDENCE;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripJsonFences(textBlock.text));
      } catch {
        return LOW_CONFIDENCE;
      }

      const coerced = coerceResult(parsed);
      if (coerced === null) {
        return LOW_CONFIDENCE;
      }
      return coerced;
    } catch (err) {
      // Log only the SDK's own error message — never any key-derived data,
      // headers, or raw response bodies. The SDK masks keys in its error
      // strings, and we add no key-bearing context.
      console.error(
        "ai.parsePickupMessage: Anthropic call failed",
        err instanceof Error ? err.message : String(err),
      );
      return LOW_CONFIDENCE;
    }
  }

  return { parsePickupMessage };
}
