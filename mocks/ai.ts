import type {
  AiService,
  ParsePickupMessageParams,
  ParsePickupMessageResult,
} from "@/interfaces/ai";
import type { PickupUrgency } from "@/lib/types";

function inferUrgency(
  lower: string,
): { urgency: PickupUrgency; inferred: boolean } {
  if (lower.includes("stat")) {
    return { urgency: "stat", inferred: true };
  }
  if (
    lower.includes("urgent") ||
    lower.includes("asap") ||
    lower.includes("rush")
  ) {
    return { urgency: "urgent", inferred: true };
  }
  return { urgency: "routine", inferred: false };
}

function firstIntegerOneTo99(body: string): number | undefined {
  const match = body.match(/\b(\d{1,2})\b/);
  if (!match) return undefined;
  const n = Number.parseInt(match[1], 10);
  if (Number.isNaN(n) || n < 1 || n > 99) return undefined;
  return n;
}

function extractSpecialInstructions(body: string): string | undefined {
  const idx = body.indexOf("\n");
  if (idx === -1) return undefined;
  const rest = body.slice(idx + 1).trim();
  return rest.length > 0 ? rest : undefined;
}

export const aiMock: AiService = {
  async parsePickupMessage(
    params: ParsePickupMessageParams,
  ): Promise<ParsePickupMessageResult> {
    const lower = params.body.toLowerCase();
    const { urgency, inferred } = inferUrgency(lower);
    const sampleCount = firstIntegerOneTo99(params.body);
    const specialInstructions = extractSpecialInstructions(params.body);

    let confidence = 0.9;
    if (!inferred) confidence -= 0.2;
    if (sampleCount === undefined) confidence -= 0.2;
    if (confidence < 0.5) confidence = 0.5;

    return {
      urgency,
      sampleCount,
      specialInstructions,
      confidence,
    };
  },
};

export function resetAiMock(): void {
  // AI mock is stateless. Exported for uniformity.
}
